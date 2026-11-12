from __future__ import annotations

import ctypes
import hashlib
import ipaddress
import json
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Optional

from .config import GPU_DIR, MODELS, MODELS_DIR, model_path

HF_OFFICIAL = "https://huggingface.co"
MODELSCOPE = "https://modelscope.cn"
CHUNK = 256 * 1024

ProgressCallback = Callable[[float, str], None]


class CancelledError(Exception):
    pass


def _validate_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"https", "http"}:
        raise RuntimeError("模型源必须是 HTTP(S) 地址")
    host = (parsed.hostname or "").lower()
    if not host:
        raise RuntimeError("模型源缺少主机名")
    try:
        address = ipaddress.ip_address(host)
        if address.is_private or address.is_loopback or address.is_link_local:
            raise RuntimeError("模型源不能指向本机或内网地址")
    except ValueError:
        pass
    return url


def _json_get(url: str) -> dict:
    request = urllib.request.Request(_validate_url(url), headers={"User-Agent": "SubtitleAuditor/0.1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _download_file(
    url: str,
    destination: Path,
    expected_size: int,
    expected_sha256: Optional[str],
    progress: Callable[[int], None],
    cancel,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + ".part")
    existing = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": "SubtitleAuditor/0.1"}
    if existing:
        headers["Range"] = f"bytes={existing}-"
    request = urllib.request.Request(_validate_url(url), headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as exc:
        if exc.code == 416 and part.exists():
            part.unlink()
            existing = 0
            response = urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": "SubtitleAuditor/0.1"}),
                timeout=120,
            )
        else:
            raise
    mode = "ab" if existing and getattr(response, "status", 200) == 206 else "wb"
    if mode == "wb":
        existing = 0
    written = existing
    try:
        with open(part, mode) as handle:
            while True:
                if cancel.is_set():
                    raise CancelledError()
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                handle.write(chunk)
                written += len(chunk)
                progress(written)
    finally:
        response.close()
    if expected_size and written != expected_size:
        raise RuntimeError(f"文件大小不匹配：{destination.name} ({written}/{expected_size})")
    if expected_sha256:
        digest = hashlib.sha256()
        with open(part, "rb") as handle:
            for chunk in iter(lambda: handle.read(CHUNK), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() != expected_sha256.lower():
            part.unlink(missing_ok=True)
            raise RuntimeError(f"SHA-256 校验失败：{destination.name}")
    os.replace(part, destination)


def _model_files(endpoint: str, repo: str) -> list[dict]:
    data = _json_get(f"{endpoint}/api/models/{repo}?blobs=true")
    files: list[dict] = []
    for sibling in data.get("siblings", []):
        name = sibling.get("rfilename", "")
        if not name or name.startswith("README") or name == ".gitattributes":
            continue
        lfs = sibling.get("lfs") or {}
        files.append(
            {
                "name": name,
                "size": int(lfs.get("size") or sibling.get("size") or 0),
                "sha256": lfs.get("sha256"),
            }
        )
    return files


def _modelscope_files(repo: str) -> list[dict]:
    data = _json_get(f"{MODELSCOPE}/api/v1/models/{repo}/repo/files?Revision=master&Recursive=true")
    files: list[dict] = []
    for item in (data.get("Data") or {}).get("Files", []):
        name = item.get("Name", "")
        if not name or item.get("Type") != "blob":
            continue
        if name == ".gitattributes" or name.startswith("README"):
            continue
        files.append(
            {
                "name": name,
                "size": int(item.get("Size") or 0),
                "sha256": item.get("Sha256"),
            }
        )
    return files


def _download_files(
    files: list[dict],
    build_url,
    source: str,
    destination: Path,
    progress: ProgressCallback,
    cancel,
) -> None:
    if not files:
        raise RuntimeError("模型仓库没有可下载文件")
    total = sum(item["size"] for item in files) or len(files)
    completed = 0
    last_report = 0.0
    for item in files:
        target = destination / item["name"]
        if target.exists() and (not item["size"] or target.stat().st_size == item["size"]):
            completed += item["size"] or 1
            continue
        url = build_url(item["name"])
        base = completed

        def on_progress(written: int, base: int = base, total: int = total) -> None:
            nonlocal last_report
            now = time.monotonic()
            if now - last_report < 0.25:
                return
            last_report = now
            progress(min(0.99, (base + written) / total), f"下载 {item['name']}")

        _download_file(url, target, item["size"], item["sha256"], on_progress, cancel)
        completed += item["size"] or 1
        progress(min(0.99, completed / total), f"已下载 {item['name']}")
    manifest = {
        "source": source,
        "files": [{"name": item["name"], "size": item["size"]} for item in files],
        "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def download_model(name: str, mirror: Optional[str], progress: ProgressCallback, cancel) -> str:
    model = next((item for item in MODELS if item["name"] == name), None)
    if model is None:
        raise RuntimeError(f"未知模型：{name}")
    destination = model_path(name)
    destination.mkdir(parents=True, exist_ok=True)
    repo = model["repo"]
    last_error: Optional[Exception] = None

    try:
        files = _modelscope_files(repo)
        build = lambda filename: f"{MODELSCOPE}/models/{repo}/resolve/master/{urllib.parse.quote(filename)}"
        _download_files(files, build, "modelscope", destination, progress, cancel)
        if not (destination / "model.bin").exists():
            raise RuntimeError("模型文件不完整：缺少 model.bin")
        progress(1.0, "模型下载完成")
        return str(destination)
    except CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - try Hugging Face fallback
        last_error = exc

    endpoints = list(dict.fromkeys(value.rstrip("/") for value in (mirror, HF_OFFICIAL) if value))
    for endpoint in endpoints:
        try:
            files = _model_files(endpoint, repo)
            build = lambda filename, endpoint=endpoint: (
                f"{endpoint}/{repo}/resolve/main/{urllib.parse.quote(filename)}?download=true"
            )
            _download_files(files, build, endpoint, destination, progress, cancel)
            if not (destination / "model.bin").exists():
                raise RuntimeError("模型文件不完整：缺少 model.bin")
            progress(1.0, "模型下载完成")
            return str(destination)
        except CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - try the next endpoint
            last_error = exc
            continue
    raise RuntimeError(f"模型下载失败：{last_error}")


def is_downloaded(name: str) -> bool:
    directory = model_path(name)
    return (directory / "model.bin").exists() and (directory / "config.json").exists()


def _directory_size(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())


def list_models() -> list[dict]:
    result = []
    for model in MODELS:
        downloaded = is_downloaded(model["name"])
        result.append(
            {
                "name": model["name"],
                "label": model["label"],
                "sizeBytes": _directory_size(model_path(model["name"]))
                if downloaded
                else model["sizeBytes"],
                "downloaded": downloaded,
                "path": str(model_path(model["name"])),
                "recommendedDevice": model["recommendedDevice"],
            }
        )
    return result


def _preload_cuda_libraries() -> str:
    """Load the GPU pack by absolute path so CTranslate2 resolves cuBLAS afterwards."""
    load_library = getattr(ctypes, "WinDLL", ctypes.CDLL)
    for name in ("cublasLt64_12.dll", "cublas64_12.dll"):
        path = GPU_DIR / name
        if path.is_file():
            try:
                load_library(str(path))
            except OSError as exc:
                return str(exc)
    try:
        load_library("cublas64_12.dll")
    except OSError as exc:
        return str(exc)
    return ""


def cuda_status() -> dict:
    """Probe CUDA the same way CTranslate2 will, before any model is built."""
    if _preload_cuda_libraries():
        return {"available": False, "deviceCount": 0, "reason": "未安装或无法加载 GPU 组件"}
    count = 0
    reason = ""
    try:
        import ctranslate2

        count = int(ctranslate2.get_cuda_device_count())
        if count <= 0:
            reason = "未检测到 NVIDIA GPU"
        elif not ctranslate2.get_supported_compute_types("cuda"):
            reason = "当前 GPU 不支持所需计算类型"
    except Exception as exc:  # noqa: BLE001 - GPU is optional
        reason = str(exc) or type(exc).__name__
    return {"available": not reason, "deviceCount": count, "reason": reason}


def gpu_status() -> dict:
    status = cuda_status()
    return {
        "gpuPackInstalled": (GPU_DIR / "cublas64_12.dll").exists()
        or (GPU_DIR / "cublasLt64_12.dll").exists(),
        "deviceCount": status["deviceCount"],
        "supported": status["available"],
        "warning": status["reason"] or None,
    }


GPU_PACKAGES = [
    {"package": "nvidia-cublas-cu12", "version": "12.9.2.10"},
    {"package": "nvidia-cuda-runtime-cu12", "version": "12.9.79"},
]


def _pypi_wheel(package: str, version: str) -> dict:
    data = _json_get(f"https://pypi.org/pypi/{package}/{version}/json")
    for file in data.get("urls", []):
        if file["filename"].endswith("win_amd64.whl"):
            return {
                "url": file["url"],
                "size": file["size"],
                "sha256": file["digests"]["sha256"],
                "filename": file["filename"],
            }
    raise RuntimeError(f"{package}=={version} 没有 Windows wheel")


def install_gpu(progress: ProgressCallback, cancel) -> dict:
    GPU_DIR.mkdir(parents=True, exist_ok=True)
    wheels = [_pypi_wheel(item["package"], item["version"]) for item in GPU_PACKAGES]
    total = sum(item["size"] for item in wheels) or 1
    completed = 0
    cache = MODELS_DIR.parent / "cache" / "gpu"
    cache.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []
    for wheel in wheels:
        target = cache / wheel["filename"]
        base = completed

        def on_progress(written: int, base: int = base, wheel=wheel) -> None:
            progress(min(0.95, (base + written) / total), f"下载 GPU 组件 {wheel['filename']}")

        _download_file(wheel["url"], target, wheel["size"], wheel["sha256"], on_progress, cancel)
        with zipfile.ZipFile(target) as archive:
            for info in archive.infolist():
                if not info.filename.lower().endswith(".dll"):
                    continue
                name = Path(info.filename).name
                with archive.open(info) as source, open(GPU_DIR / name, "wb") as output:
                    shutil.copyfileobj(source, output)
                installed.append(name)
        completed += wheel["size"]
        target.unlink(missing_ok=True)
    (GPU_DIR / "manifest.json").write_text(
        json.dumps({"files": sorted(set(installed)), "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2),
        encoding="utf-8",
    )
    progress(1.0, "GPU 组件安装完成，重启应用后生效")
    return {"installed": sorted(set(installed)), "directory": str(GPU_DIR)}
