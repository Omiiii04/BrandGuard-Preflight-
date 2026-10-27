# Deterministic fallback evaluation

Command:

```powershell
cd ml_service
.\.venv\Scripts\python.exe -m evaluation.evaluator
```

Measured on the five-case offline fixture in `evaluation/test_set.json`:

| Metric | Result |
| --- | ---: |
| True positives | 5 |
| False positives | 0 |
| False negatives | 0 |
| Precision | 1.00 |
| Recall | 1.00 |
| Citation rate | 0.60 |
| Brier score | 0.06732 |

Precision and recall are exact `(ruleId, verdict)` matches. Citation rate is the
fraction of predicted claims with a proof passage identifier. Brier score treats
an expected exact match as 1 and the model confidence as its probability.

These are fixture results for the deterministic Stellara fallback, not a claim
of production model quality. The dataset is intentionally small, has no held-out
split, and does not measure OCR, NLI, multilingual content, or model-assisted
rewriting. Expand the fixture before using these numbers for threshold tuning.
