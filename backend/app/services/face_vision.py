"""YuNet detection, alignment, quality checks and one-to-one SFace matching."""

import base64
import binascii
import hashlib
import io
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

MODEL_VERSION = "yunet-2023mar+sface-2021dec/v1"
MODEL_DIR = Path(__file__).resolve().parents[2] / "face_models"
MODELS = {
    "face_detection_yunet_2023mar.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "face_recognition_sface_2021dec.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}
MAX_BYTES = 2 * 1024 * 1024


class FaceError(Exception):
    def __init__(self, message, code="FACE_INVALID", status=422):
        super().__init__(message)
        self.code, self.status = code, status


@dataclass
class Observation:
    embedding: object
    yaw: float
    center: tuple
    size: float
    fingerprint: bytes


def decode_photo(encoded):
    import cv2
    import numpy as np
    from PIL import Image, ImageOps

    if not isinstance(encoded, str) or len(encoded) > (MAX_BYTES + 2) // 3 * 4:
        raise FaceError("Choose a JPEG or PNG photograph under 2 MiB.")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > MAX_BYTES:
            raise ValueError()
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG"]) as source:
            w, h = source.size
            if (
                min(w, h) < 120
                or w * h > 8_000_000
                or getattr(source, "n_frames", 1) != 1
            ):
                raise ValueError()
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((800, 800), Image.Resampling.LANCZOS)
            return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    except (ValueError, OSError, binascii.Error, Image.DecompressionBombError):
        raise FaceError(
            "Use a single JPEG or PNG, at least 120 pixels per side and at most 8 megapixels."
        ) from None


class Vision:
    def __init__(self, directory):
        import cv2

        paths = []
        for name, expected in MODELS.items():
            path = Path(directory) / name
            with path.open("rb") as file:
                if hashlib.sha256(file.read()).hexdigest() != expected:
                    raise RuntimeError(f"Face model checksum mismatch: {name}")
            paths.append(str(path))
        self.detector = cv2.FaceDetectorYN.create(
            paths[0], "", (320, 320), 0.82, 0.3, 5000
        )
        self.recognizer = cv2.FaceRecognizerSF.create(paths[1], "")
        self.lock = threading.Lock()

    def observe(self, encoded):
        import cv2
        import numpy as np

        image = decode_photo(encoded)
        h, w = image.shape[:2]
        with self.lock:  # OpenCV networks have mutable input and output buffers.
            self.detector.setInputSize((w, h))
            _, faces = self.detector.detect(image)
            if faces is None or len(faces) != 1:
                raise FaceError("Keep exactly one face in the guide.", "FACE_QUALITY")
            face = faces[0]
            x, y, fw, fh = map(float, face[:4])
            if min(fw, fh) < 60 or x < 0 or y < 0 or x + fw > w or y + fh > h:
                raise FaceError(
                    "Move closer and keep your entire face visible.", "FACE_QUALITY"
                )
            aligned = self.recognizer.alignCrop(image, face)
            gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
            if (
                not 45 <= gray.mean() <= 220
                or cv2.Laplacian(gray, cv2.CV_64F).var() < 38
            ):
                raise FaceError(
                    "Use even lighting and hold still for a sharper image.",
                    "FACE_QUALITY",
                )
            feature = self.recognizer.feature(aligned).reshape(-1).copy()
        norm = np.linalg.norm(feature)
        if feature.size != 128 or not np.isfinite(norm) or norm < 1e-6:
            raise FaceError("Please try a clearer view.", "FACE_QUALITY")
        eyes = face[4:8].reshape(2, 2)[:, 0]
        yaw = (float(face[8]) - float(eyes.mean())) / max(
            1, abs(float(eyes[0] - eyes[1]))
        )
        thumb = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
        fingerprint = np.packbits(thumb[:, 1:] > thumb[:, :-1]).tobytes()
        return Observation(
            feature / norm,
            yaw,
            ((x + fw / 2) / w, (y + fh / 2) / h),
            fw / w,
            fingerprint,
        )


@lru_cache(maxsize=2)
def engine(directory):
    return Vision(directory)


def enroll(photos, model, threshold):
    import numpy as np

    if not isinstance(photos, list) or not 3 <= len(photos) <= 5:
        raise FaceError("Select three to five different photographs.")
    samples = []
    for i, photo in enumerate(photos, 1):
        try:
            sample = model.observe(photo)
            for previous in samples:
                bits = int.from_bytes(previous.fingerprint, "big") ^ int.from_bytes(
                    sample.fingerprint, "big"
                )
                if bits.bit_count() < 3:
                    raise FaceError(
                        "Choose a different photograph. This view is already included."
                    )
                if float(previous.embedding @ sample.embedding) < threshold:
                    raise FaceError("All photographs must show the same employee.")
        except FaceError as exc:
            raise FaceError(f"Photo {i}: {exc}", exc.code) from None
        samples.append(sample)
    mean = np.mean([s.embedding for s in samples], axis=0)
    return (mean / np.linalg.norm(mean)).astype("<f4").tobytes()


def check_pose(sample, prompt, base):
    x, y = sample.center
    if not (0.22 <= x <= 0.78 and 0.2 <= y <= 0.78 and 0.12 <= sample.size <= 0.86):
        raise FaceError("Place your face in the middle of the guide.", "FACE_POSITION")
    delta = sample.yaw
    if base:
        if (
            abs(x - base["x"]) > 0.2
            or abs(y - base["y"]) > 0.2
            or not 0.55 <= sample.size / base["size"] <= 1.65
        ):
            raise FaceError(
                "Keep the camera still and move only your head.", "FACE_POSITION"
            )
        delta -= base["yaw"]
    ready = {"center": abs(delta) < 0.15, "left": delta > 0.22, "right": delta < -0.22}[
        prompt
    ]
    if not ready:
        raise FaceError(
            "Look straight ahead."
            if prompt == "center"
            else f"Turn a little farther to your {prompt}.",
            "FACE_POSE",
        )
