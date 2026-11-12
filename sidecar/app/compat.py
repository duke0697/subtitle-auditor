"""Third-party version shims.

faster-whisper 1.2.1 calls av.open(metadata_errors=...), which was removed in
PyAV 19. The option only controls metadata parse error handling; dropping it
does not change decoding behaviour.
"""

from __future__ import annotations

import av

_original_open = av.open


def _open_without_metadata_errors(*args, **kwargs):
    kwargs.pop("metadata_errors", None)
    return _original_open(*args, **kwargs)


av.open = _open_without_metadata_errors
