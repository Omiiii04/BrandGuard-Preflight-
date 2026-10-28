from types import ModuleType, SimpleNamespace
import sys

from app.pipeline import judge


def test_configured_nli_cross_encoder_returns_entailment(monkeypatch):
    class FakeCrossEncoder:
        def __init__(self, model_name, device, max_length):
            assert model_name == "cross-encoder/nli-deberta-v3-base"
            assert device == "cpu"
            self.model = SimpleNamespace(config=SimpleNamespace(
                id2label={0: "contradiction", 1: "entailment", 2: "neutral"}
            ))

        def predict(self, pairs, apply_softmax):
            assert pairs == [("Evidence states returns are allowed for 30 days.", "Returns are allowed for 30 days.")]
            assert apply_softmax is True
            return [[0.02, 0.95, 0.03]]

    module = ModuleType("sentence_transformers")
    module.CrossEncoder = FakeCrossEncoder
    monkeypatch.setitem(sys.modules, "sentence_transformers", module)
    monkeypatch.setenv("NLI_ENABLED", "true")
    monkeypatch.setenv("NLI_MODEL_NAME", "cross-encoder/nli-deberta-v3-base")
    monkeypatch.setenv("NLI_DEVICE", "cpu")
    monkeypatch.setenv("NLI_ENTAILMENT_THRESHOLD", "0.72")
    monkeypatch.setattr(judge, "_NLI_MODEL", None)
    monkeypatch.setattr(judge, "_NLI_MODEL_NAME", None)

    result = judge._nli_prediction(
        "Returns are allowed for 30 days.",
        "Evidence states returns are allowed for 30 days.",
    )
    assert result["verdict"] == "Supported"
    assert result["confidence"] == 0.95


def test_nli_defaults_to_deterministic_mode_without_model_name(monkeypatch):
    monkeypatch.delenv("NLI_MODEL_NAME", raising=False)
    assert judge._nli_prediction("claim", "evidence") is None
