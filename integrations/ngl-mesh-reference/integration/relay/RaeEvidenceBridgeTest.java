package ngl.relay.integration;
import ngl.relay.core.*;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;

public final class RaeEvidenceBridgeTest {
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        File apk = new File(args[0]), report = new File(args[1]);
        File base = new File(args[2]);
        CaseStore store = new CaseStore(base);
        CaseStore.CaseMeta meta = store.createCase("Integration test fixture", "Test fixture: inspect supplied Relay reference evidence");
        Artifact event = RaeEvidenceBridge.append(store, meta.caseId, apk, report);
        check(event.type == Artifact.Type.SYSTEM_EVENT, "must not create human decision");
        check(event.parents.contains(meta.originalInputArtifactId), "original human input parent");
        check(store.getMeta(meta.caseId).methodologyStage == 0, "must not advance stage");
        check(store.getMeta(meta.caseId).humanDecision == null, "must not grant human authority");
        check(new CaseStore(base).getArtifact(meta.caseId,event.id).hash.equals(event.hash), "restart persistence");
        check(store.audit(meta.caseId).isEmpty(), "clean recovered CaseStore audit");
        try { RaeEvidenceBridge.append(store,meta.caseId,apk,report); throw new AssertionError("duplicate accepted"); }
        catch (IllegalStateException expected) { check(expected.getMessage().contains("IMMUTABILITY"), "duplicate rejection"); }
        File forged = new File(base,"forged.json");
        Files.write(forged.toPath(),"{\"observation\":{\"artifact\":{\"sha256\":\"fake\",\"byte_length\":49651}}}".getBytes(StandardCharsets.UTF_8));
        try { RaeEvidenceBridge.append(store,meta.caseId,apk,forged); throw new AssertionError("forgery accepted"); }
        catch (IllegalArgumentException expected) { check(expected.getMessage().contains("report_artifact_mismatch"), "forged binding rejected"); }
        File changed = new File(base,"changed.apk");
        byte[] bytes = Files.readAllBytes(apk.toPath()); bytes[bytes.length-1] ^= 1;
        Files.write(changed.toPath(),bytes);
        try { RaeEvidenceBridge.append(store,meta.caseId,changed,report); throw new AssertionError("changed APK accepted"); }
        catch (IllegalArgumentException expected) { check(expected.getMessage().contains("reference_identity_mismatch"), "changed APK rejected"); }
        check(store.byType(meta.caseId,Artifact.Type.ERROR).size()==3, "failure evidence persisted");
        check(store.audit(meta.caseId).isEmpty(), "audit after rejection");
        System.out.println("RAE_RELAY_BRIDGE: 11 checks passed; case=" + meta.caseId);
    }
}
