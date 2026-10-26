package ngl.mesh;

import java.time.Instant;
import java.util.*;

/**
 * Executable reference contract for NGL cognition/evidence/tool nodes.
 *
 * Design invariant: a node is not defined as "prompt -> completion".
 * It is a capability-bearing execution peer that consumes canonical artifact ids
 * and emits provenance-linked result records. Provider identity never grants authority.
 */
public final class NodeContract {
    private NodeContract() {}

    public enum NodeKind {
        COGNITION,
        EVIDENCE,
        TOOL,
        LOCAL_MODEL,
        TRAINING,
        EVALUATION
    }

    public enum Transport {
        OPENAI_COMPAT,
        ANTHROPIC_COMPAT,
        GENERIC_HTTP,
        LOCAL_HTTP,
        IN_PROCESS,
        JOB_RUNNER
    }

    public enum Capability {
        CHAT,
        RESPONSES,
        STREAM,
        TOOLS,
        STRUCTURED_OUTPUT,
        VISION,
        AUDIO_TRANSCRIBE,
        EMBEDDINGS,
        SEARCH,
        LOOKUP,
        RETRIEVE,
        EXECUTE,
        TRAIN,
        EVALUATE
    }

    public enum Health {
        UNTESTED,
        READY,
        RATE_LIMITED,
        AUTH_FAILED,
        UNREACHABLE,
        INCOMPATIBLE,
        DISABLED
    }

    public enum AuthorityStatus {
        UNCLAIMED,
        CLAIMED,
        PROPOSED,
        AUTHORIZED,
        REJECTED,
        SUPERSEDED,
        UNKNOWN
    }

    public enum ExecutionStatus {
        SUCCEEDED,
        FAILED,
        REJECTED
    }

    public record NodeProfile(
            String nodeId,
            NodeKind kind,
            Transport transport,
            String endpointBase,
            Set<Capability> capabilities,
            Health health,
            AuthorityStatus authorityStatus,
            Map<String, String> publicMetadata) {

        public NodeProfile {
            Objects.requireNonNull(nodeId, "nodeId");
            Objects.requireNonNull(kind, "kind");
            Objects.requireNonNull(transport, "transport");
            Objects.requireNonNull(capabilities, "capabilities");
            Objects.requireNonNull(health, "health");
            Objects.requireNonNull(authorityStatus, "authorityStatus");
            capabilities = Set.copyOf(capabilities);
            publicMetadata = publicMetadata == null ? Map.of() : Map.copyOf(publicMetadata);
            if (nodeId.isBlank()) throw new IllegalArgumentException("nodeId must not be blank");
        }

        public boolean supports(Capability capability) {
            return health == Health.READY && capabilities.contains(capability);
        }
    }

    /** Canonical request references artifacts; it never embeds provider request JSON as state. */
    public record ExecutionRequest(
            String requestId,
            String operation,
            Capability requiredCapability,
            List<String> inputArtifactIds,
            List<String> provenanceParents,
            Map<String, String> parameters,
            boolean allowFallback,
            String humanAuthorizationArtifactId) {

        public ExecutionRequest {
            Objects.requireNonNull(requestId, "requestId");
            Objects.requireNonNull(operation, "operation");
            Objects.requireNonNull(requiredCapability, "requiredCapability");
            inputArtifactIds = List.copyOf(inputArtifactIds == null ? List.of() : inputArtifactIds);
            provenanceParents = List.copyOf(provenanceParents == null ? List.of() : provenanceParents);
            parameters = Map.copyOf(parameters == null ? Map.of() : parameters);
            if (requestId.isBlank()) throw new IllegalArgumentException("requestId must not be blank");
            if (operation.isBlank()) throw new IllegalArgumentException("operation must not be blank");
            if (allowFallback && (humanAuthorizationArtifactId == null || humanAuthorizationArtifactId.isBlank())) {
                throw new IllegalArgumentException("fallback requires explicit human authorization artifact");
            }
        }
    }

    /** Provider-local payloads are represented by artifact ids, never elevated to canonical semantics. */
    public record ExecutionResult(
            String resultId,
            String requestId,
            String nodeId,
            ExecutionStatus status,
            Instant startedAt,
            Instant completedAt,
            int httpStatus,
            long latencyMs,
            String providerResolved,
            String modelResolved,
            String rawRequestArtifactId,
            String rawResponseArtifactId,
            String normalizedOutputArtifactId,
            String errorArtifactId,
            List<String> provenanceParents) {

        public ExecutionResult {
            Objects.requireNonNull(resultId, "resultId");
            Objects.requireNonNull(requestId, "requestId");
            Objects.requireNonNull(nodeId, "nodeId");
            Objects.requireNonNull(status, "status");
            Objects.requireNonNull(startedAt, "startedAt");
            Objects.requireNonNull(completedAt, "completedAt");
            provenanceParents = List.copyOf(provenanceParents == null ? List.of() : provenanceParents);
            if (latencyMs < 0) throw new IllegalArgumentException("latencyMs must be >= 0");
            if (status == ExecutionStatus.SUCCEEDED && normalizedOutputArtifactId == null) {
                throw new IllegalArgumentException("success requires normalized output artifact");
            }
            if (status != ExecutionStatus.SUCCEEDED && errorArtifactId == null) {
                throw new IllegalArgumentException("failure/rejection requires error artifact");
            }
        }
    }

    public record RouteDecision(String nodeId, String reason) {}

    /** Deterministic capability router. Cost/latency policy may be layered on later. */
    public static RouteDecision route(ExecutionRequest request, Collection<NodeProfile> profiles) {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(profiles, "profiles");

        return profiles.stream()
                .filter(p -> p.supports(request.requiredCapability()))
                .sorted(Comparator.comparing(NodeProfile::nodeId))
                .findFirst()
                .map(p -> new RouteDecision(
                        p.nodeId(),
                        "READY node matched capability " + request.requiredCapability()))
                .orElseThrow(() -> new IllegalStateException(
                        "no READY node provides capability " + request.requiredCapability()));
    }

    /**
     * Authority is intentionally not derived from provider, transport, success, or model identity.
     */
    public static boolean executionCanGrantAuthority(NodeProfile profile, ExecutionResult result) {
        Objects.requireNonNull(profile, "profile");
        Objects.requireNonNull(result, "result");
        return false;
    }
}
