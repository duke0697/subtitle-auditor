from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "SubtitleAuditor"
SCHEMA_VERSION = 1

LOCAL_APP_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / APP_NAME
MODELS_DIR = LOCAL_APP_DATA / "models"
GPU_DIR = LOCAL_APP_DATA / "gpu"
CACHE_DIR = LOCAL_APP_DATA / "cache"

MODELS = [
    {
        "name": "small",
        "label": "Small · 快速",
        "repo": "Systran/faster-whisper-small",
        "sizeBytes": 500_000_000,
        "recommendedDevice": "cpu",
    },
    {
        "name": "medium",
        "label": "Medium · 均衡",
        "repo": "Systran/faster-whisper-medium",
        "sizeBytes": 1_500_000_000,
        "recommendedDevice": "cpu",
    },
    {
        "name": "large-v3",
        "label": "Large v3 · 高精度",
        "repo": "Systran/faster-whisper-large-v3",
        "sizeBytes": 3_100_000_000,
        "recommendedDevice": "cuda",
    },
]

DEFAULT_OPTIONS = {
    "model": "medium",
    "device": "auto",
    "language": None,
    "glossary": ["三电小车", "高压互锁", "CAN通讯", "线束", "BMS", "MCU", "绝缘检测", "端子"],
    "confidenceThreshold": 0.9,
    "uncertainThreshold": 0.65,
    "pinyinThreshold": 0.8,
    "alignmentThreshold": 0.85,
    "timingToleranceMs": 500,
    "globalOffsetMs": 500,
    "t2s": True,
}


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent.parent
    return Path(__file__).resolve().parents[2]


def ffmpeg_binary(name: str) -> Path:
    candidates = [
        resource_root() / "ffmpeg" / name,
        Path(__file__).resolve().parents[2] / "resources" / "ffmpeg" / name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def model_path(name: str) -> Path:
    return MODELS_DIR / name


_DLL_DIRECTORIES: list = []


def setup_dll_paths() -> None:
    """Make bundled / downloaded native DLLs discoverable before importing ctranslate2."""
    for directory in (GPU_DIR, app_root(), app_root() / "ctranslate2"):
        if not directory.exists():
            continue
        try:
            # The cookie must stay alive, otherwise the directory is dropped again.
            _DLL_DIRECTORIES.append(os.add_dll_directory(str(directory)))
        except (AttributeError, OSError):
            pass
        os.environ["PATH"] = f"{directory}{os.pathsep}{os.environ.get('PATH', '')}"


def ensure_dirs() -> None:
    for directory in (MODELS_DIR, GPU_DIR, CACHE_DIR):
        directory.mkdir(parents=True, exist_ok=True)
