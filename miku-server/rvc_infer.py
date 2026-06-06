"""
ClaudeDeck — fairseq-free RVC inference engine.

The stock RVC pipeline loads its HuBERT content encoder through `fairseq`, which
hard-pins `fairseq==0.12.2` (a 2022 package that does not build on Python 3.12/3.13
or on Windows). This module keeps the *proven* RVC model + pipeline code (vendored
under ./rvc, MIT, from RVC-Project) but swaps the content encoder for ContentVec
loaded via HuggingFace `transformers` — so it runs on the Python the user already
has, no fairseq, no extra interpreter.

Pipeline:  16 kHz mono waveform
             → ContentVec features (transformers HubertModel, fairseq-free)
             → RMVPE pitch (pure torch)
             → optional faiss .index retrieval
             → RVC SynthesizerTrnMs768NSFsid  → target-sr int16 audio
"""

from __future__ import annotations

import os
import sys
import logging

import numpy as np
import torch

logger = logging.getLogger("miku.rvc")

# Make the vendored RVC package importable as `infer.lib...` exactly as it expects.
_HERE = os.path.dirname(os.path.abspath(__file__))
_RVC_ROOT = os.path.join(_HERE, "rvc")
if _RVC_ROOT not in sys.path:
    sys.path.insert(0, _RVC_ROOT)


class _Config:
    """Minimal stand-in for RVC's Config (only the fields Pipeline reads)."""

    def __init__(self, device: str, is_half: bool):
        self.device = device
        self.is_half = is_half
        # Full-precision padding window sizes (RVC defaults for is_half=False).
        self.x_pad = 1
        self.x_query = 6
        self.x_center = 38
        self.x_max = 41


class _ContentVec:
    """fairseq-free drop-in for the HuBERT/ContentVec encoder.

    Exposes the two attributes RVC's pipeline calls on the fairseq model:
      - extract_features(source, padding_mask, output_layer) -> (features,)
      - final_proj (only used for v1 models; absent here -> v2 only)
    `lengyue233/content-vec-best` is the HF port whose last_hidden_state matches
    the ContentVec features RVC v2 was trained on.
    """

    def __init__(self, device: str, is_half: bool):
        from transformers import HubertModel

        logger.info("Loading ContentVec (lengyue233/content-vec-best)…")
        model = HubertModel.from_pretrained("lengyue233/content-vec-best")
        model = model.to(device).eval()
        if is_half:
            model = model.half()
        self.model = model
        self.device = device
        self.is_half = is_half

    @torch.no_grad()
    def extract_features(self, source, padding_mask=None, output_layer=12, **_):
        # source: [1, T] raw waveform at 16 kHz, already on the right device/dtype.
        out = self.model(source)
        return (out.last_hidden_state,)


class MikuRVC:
    def __init__(self, model_path: str, index_path: str = "", *,
                 device: str | None = None, is_half: bool = False):
        if device is None:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.device = device
        self.is_half = is_half and device.startswith("cuda")
        self.index_path = index_path if index_path and os.path.exists(index_path) else ""

        logger.info("Device=%s  is_half=%s", self.device, self.is_half)
        self._ensure_rmvpe()
        self.hubert = _ContentVec(self.device, self.is_half)
        self._load_synth(model_path)

        from infer.modules.vc.pipeline import Pipeline

        self.pipeline = Pipeline(self.tgt_sr, _Config(self.device, self.is_half))

    # ── setup ────────────────────────────────────────────────────────────────
    def _ensure_rmvpe(self) -> None:
        """RVC's pipeline reads os.environ['rmvpe_root']/rmvpe.pt for pitch."""
        root = os.environ.get("rmvpe_root")
        if root and os.path.exists(os.path.join(root, "rmvpe.pt")):
            return
        cache = os.path.join(_HERE, "models")
        os.makedirs(cache, exist_ok=True)
        target = os.path.join(cache, "rmvpe.pt")
        if not os.path.exists(target):
            logger.info("Downloading rmvpe.pt (pitch model, ~180 MB)…")
            from huggingface_hub import hf_hub_download

            got = hf_hub_download(
                repo_id="lj1995/VoiceConversionWebUI", filename="rmvpe.pt"
            )
            import shutil

            shutil.copyfile(got, target)
        os.environ["rmvpe_root"] = cache

    def _load_synth(self, model_path: str) -> None:
        from infer.lib.infer_pack.models import (
            SynthesizerTrnMs256NSFsid,
            SynthesizerTrnMs768NSFsid,
        )

        logger.info("Loading RVC model: %s", model_path)
        cpt = torch.load(model_path, map_location="cpu", weights_only=False)
        self.tgt_sr = cpt["config"][-1]
        self.version = cpt.get("version", "v1")
        self.if_f0 = int(cpt.get("f0", 1))
        # speaker count from the checkpoint
        cpt["config"][-3] = cpt["weight"]["emb_g.weight"].shape[0]

        if self.version == "v1":
            raise RuntimeError(
                "This fairseq-free engine supports RVC v2 models only "
                "(ContentVec 768-dim). Your model reports v1."
            )
        net_g = SynthesizerTrnMs768NSFsid(*cpt["config"], is_half=self.is_half)
        del net_g.enc_q  # not needed for inference
        net_g.load_state_dict(cpt["weight"], strict=False)
        net_g = net_g.to(self.device).eval()
        net_g = net_g.half() if self.is_half else net_g.float()
        self.net_g = net_g
        logger.info("Model ready: version=%s sr=%s f0=%s", self.version,
                    self.tgt_sr, self.if_f0)

    # ── inference ────────────────────────────────────────────────────────────
    def convert(self, audio16k: np.ndarray, *, f0_up_key: int = 0,
                index_rate: float = 0.5) -> tuple[np.ndarray, int]:
        """audio16k: float32 mono at 16 kHz. Returns (int16 audio, target_sr)."""
        times = [0.0, 0.0, 0.0]
        audio_opt = self.pipeline.pipeline(
            self.hubert,         # model
            self.net_g,          # net_g
            0,                   # sid (speaker 0)
            audio16k,            # audio
            "miku",              # input_audio_path (cache key only)
            times,
            f0_up_key,
            "rmvpe",             # f0_method (pure torch)
            self.index_path,     # file_index
            index_rate if self.index_path else 0.0,
            self.if_f0,
            3,                   # filter_radius
            self.tgt_sr,
            0,                   # resample_sr (0 -> keep tgt_sr)
            0.25,                # rms_mix_rate
            self.version,
            0.33,                # protect
        )
        return audio_opt, self.tgt_sr
