package ngl.mesh;

import java.time.Instant;
import java.util.*;
import static ngl.mesh.NodeContract.*;

public final class NodeContractSelfTest {
    private static int passed = 0;

    public static void main(String[] args) {
        testNonChatNodeRoutes();
        testProviderSuccessCannotGrantAuthority();
        testFallbackRequiresHumanAuthorization();
        testFailuresRequireErrorArtifact();
        testUnhealthyNodeDoesNotRoute();
        System.out.println("PASS " + passed + "/5 NGL node-contract invariants");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        passed++;
    }

    private static NodeProfile profile(String id, NodeKind kind, Health health, Capability... caps) {
        return new NodeProfile(
                id,
                kind,
                Transport.GENERIC_HTTP,
                "https://example.invalid",
                Set.of(caps),
                health,
                AuthorityStatus.PROPOSED,
                Map.of("producer", "external"));
    }

    private static void testNonChatNodeRoutes() {
        var evidence = profile("crossref", NodeKind.EVIDENCE, Health.READY, Capability.SEARCH, Capability.LOOKUP);
        var request = new ExecutionRequest(
                "r1", "literature.search", Capability.SEARCH,
                List.of("artifact:query"), List.of("artifact:human-input"), Map.of(), false, null);
        var route = NodeContract.route(request, List.of(evidence));
        check(route.nodeId().equals("crossref"), "router must support non-chat evidence nodes");
    }

    private static void testProviderSuccessCannotGrantAuthority() {
        var model = profile("groq", NodeKind.COGNITION, Health.READY, Capability.CHAT);
        var result = new ExecutionResult(
                "x1", "r2", "groq", ExecutionStatus.SUCCEEDED,
                Instant.EPOCH, Instant.EPOCH.plusMillis(12), 200, 12,
                "groq", "model-x",
                "artifact:req", "artifact:raw", "artifact:norm", null,
                List.of("artifact:r2"));
        check(!NodeContract.executionCanGrantAuthority(model, result),
                "successful provider execution must not grant authority");
    }

    private static void testFallbackRequiresHumanAuthorization() {
        boolean rejected = false;
        try {
            new ExecutionRequest(
                    "r3", "cognition.chat", Capability.CHAT,
                    List.of("artifact:input"), List.of(), Map.of(), true, null);
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        check(rejected, "cross-node fallback must require explicit human authorization artifact");
    }

    private static void testFailuresRequireErrorArtifact() {
        boolean rejected = false;
        try {
            new ExecutionResult(
                    "x2", "r4", "openai", ExecutionStatus.FAILED,
                    Instant.EPOCH, Instant.EPOCH.plusMillis(1), 429, 1,
                    "openai", "model-y",
                    "artifact:req", "artifact:raw", null, null,
                    List.of("artifact:r4"));
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        check(rejected, "failed execution must preserve an error artifact");
    }

    private static void testUnhealthyNodeDoesNotRoute() {
        var limited = profile("limited", NodeKind.COGNITION, Health.RATE_LIMITED, Capability.CHAT);
        var ready = profile("ready", NodeKind.COGNITION, Health.READY, Capability.CHAT);
        var request = new ExecutionRequest(
                "r5", "cognition.chat", Capability.CHAT,
                List.of("artifact:input"), List.of(), Map.of(), false, null);
        var route = NodeContract.route(request, List.of(limited, ready));
        check(route.nodeId().equals("ready"), "router must exclude unhealthy nodes");
    }
}
