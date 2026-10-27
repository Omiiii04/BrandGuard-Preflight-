from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


Verdict = Literal["Supported", "Contradicted", "Outdated", "Not Found", "Unclear"]


class Span(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def end_after_start(self):
        if self.end < self.start:
            raise ValueError("end must be greater than or equal to start")
        return self


class MeaningCheck(BaseModel):
    kept: list[str] = Field(default_factory=list)
    changed: list[str] = Field(default_factory=list)
    dropped: list[str] = Field(default_factory=list)


class DraftIntent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    purpose: str = ""
    audience: str = ""
    mustSay: list[str] = Field(default_factory=list)


class MlClaim(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str = ""
    type: Literal[
        "temporal", "numerical", "percentage", "product-term", "superlative", "promotional", "other", "violation", "question"
    ]
    span: Span
    verdict: Optional[Verdict] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    ruleId: Optional[str] = None
    proofPassageId: Optional[str] = None
    suggestedFix: Optional[str] = None
    meaningCheck: Optional[MeaningCheck] = None


class ExtractClaimsRequest(BaseModel):
    content: str
    orgId: Optional[str] = None
    intent: Optional[DraftIntent] = None


class ExtractClaimsResponse(BaseModel):
    claims: list[MlClaim]
    message: Optional[str] = None


class MlPassage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    passageId: str
    text: str
    sourceId: Optional[str] = None
    page: int = 0
    score: float = Field(default=0, ge=0, le=1)
    expiryDate: Optional[str] = None


class MlMatch(BaseModel):
    claim: MlClaim
    passages: list[MlPassage] = Field(default_factory=list)
    verdict: Verdict
    confidence: float = Field(ge=0, le=1)


class PremortemRisk(BaseModel):
    viewpoint: Literal["regulatory", "brand", "customer", "competitor"]
    riskLine: str
    severity: Literal["high", "medium", "low"]


class ImageCheckResult(BaseModel):
    checkType: Literal["contrast", "palette", "alt-text"]
    passed: bool
    details: Optional[str] = None
    wcagLevel: Optional[Literal["A", "AA", "AAA"]] = None


class MlEntity(BaseModel):
    text: str
    type: Literal["product", "competitor", "person", "place", "legal-term", "embargoed", "other"]
    isWatchlisted: bool
    span: Optional[Span] = None
