"""Dependency-free image metadata checks for the internal image endpoint."""

from collections import Counter
import math
from typing import Iterable, Sequence


def _rgb(value: Sequence[int]) -> tuple[int, int, int]:
    if len(value) != 3 or any(not isinstance(channel, (int, float)) for channel in value):
        raise ValueError("RGB values must contain three numbers")
    return tuple(max(0, min(255, int(channel))) for channel in value)


def _luminance(rgb: Sequence[int]) -> float:
    channels = []
    for channel in _rgb(rgb):
        value = channel / 255
        channels.append(value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(foreground: Sequence[int], background: Sequence[int]) -> float:
    first, second = _luminance(foreground), _luminance(background)
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)


def analyze_image(payload: dict) -> list[dict]:
    results = []
    pixels = payload.get("pixels") or []
    palette = payload.get("brandPalette") or []
    if pixels and palette:
        try:
            colors = Counter(_rgb(pixel) for pixel in pixels)
            dominant = [color for color, _ in colors.most_common(5)]
            brand = [_rgb(color) for color in palette]
            distances = [min(math.dist(color, expected) for expected in brand) for color in dominant]
            passed = max(distances, default=999) <= 45
            results.append({
                "checkType": "palette",
                "passed": passed,
                "details": "Dominant colours match the supplied brand palette." if passed else "One or more dominant colours fall outside the supplied brand palette.",
            })
        except (TypeError, ValueError):
            results.append({"checkType": "palette", "passed": False, "details": "Pixel or palette data could not be evaluated."})
    elif payload.get("brandPalette") is not None:
        results.append({"checkType": "palette", "passed": False, "details": "No pixel data was supplied; palette match was not evaluated."})

    foreground, background = payload.get("textForeground"), payload.get("textBackground")
    if foreground is not None and background is not None:
        try:
            ratio = contrast_ratio(foreground, background)
            results.append({
                "checkType": "contrast",
                "passed": ratio >= 4.5,
                "wcagLevel": "AA" if ratio >= 4.5 else "A",
                "details": f"Contrast ratio {ratio:.2f}:1; WCAG AA requires at least 4.5:1.",
            })
        except (TypeError, ValueError):
            results.append({"checkType": "contrast", "passed": False, "details": "Text colours could not be evaluated."})

    alt_text = payload.get("altText")
    if alt_text is not None or pixels or payload.get("storageRef"):
        present = bool(isinstance(alt_text, str) and alt_text.strip())
        results.append({
            "checkType": "alt-text",
            "passed": present,
            "details": "Alt text is present." if present else "Alt text is missing.",
        })
    return results
