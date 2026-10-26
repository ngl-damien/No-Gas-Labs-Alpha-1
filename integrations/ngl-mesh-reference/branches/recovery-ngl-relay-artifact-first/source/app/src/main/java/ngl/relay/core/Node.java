package ngl.relay.core;
public interface Node {
  String nodeId(); String provider(); String model(); String label(); String endpoint(); boolean isConfigured();
  NodeResult execute(String prompt,int timeoutMillis) throws NodeException;
  final class NodeResult { public final String rawBody,model; public final int httpStatus; public final long latencyMillis; public NodeResult(String body,String model,int status,long latency){this.rawBody=body;this.model=model;this.httpStatus=status;this.latencyMillis=latency;} }
  final class NodeException extends Exception { public final int httpStatus; public final String rawBody; public NodeException(String m,int s,String b){super(m);httpStatus=s;rawBody=b;} }
}
