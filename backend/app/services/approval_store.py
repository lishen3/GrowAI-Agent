from threading import Lock
from typing import Protocol

from app.models.replan_approval import ApprovalRequest
from app.services.replan_approval_contract import content_digest


class ApprovalStore(Protocol):
    def save(self, request: ApprovalRequest) -> None: ...
    def get(self, approval_id: str) -> ApprovalRequest | None: ...
    def update(self, request: ApprovalRequest, *, expected_digest: str) -> bool: ...


class InMemoryApprovalStore:
    """Explicitly owned storage; atomic PENDING-to-terminal updates, no execution."""

    def __init__(self):
        self._requests: dict[str, ApprovalRequest] = {}
        self._lock = Lock()

    def save(self, request: ApprovalRequest) -> None:
        request = ApprovalRequest.model_validate(request.model_dump())
        if request.status != 'PENDING' or content_digest(request) != request.selectedContentDigest:
            raise ValueError('Only intact pending approvals may be saved')
        with self._lock:
            if request.id in self._requests:
                raise ValueError('Approval ID already exists')
            self._requests[request.id] = request.model_copy(deep=True)

    def get(self, approval_id: str) -> ApprovalRequest | None:
        with self._lock:
            request = self._requests.get(approval_id)
            return request.model_copy(deep=True) if request else None

    def update(self, request: ApprovalRequest, *, expected_digest: str) -> bool:
        request = ApprovalRequest.model_validate(request.model_dump())
        if request.status not in ('APPROVED', 'REJECTED', 'EXPIRED', 'INVALID'):
            raise ValueError('Only terminal decisions may update a pending approval')
        with self._lock:
            current = self._requests.get(request.id)
            if current is None or current.status != 'PENDING' or current.selectedContentDigest != expected_digest:
                return False
            if request.selectedContentDigest != expected_digest or content_digest(request) != content_digest(current):
                raise ValueError('Approval content cannot change during a decision')
            self._requests[request.id] = request.model_copy(deep=True)
            return True
