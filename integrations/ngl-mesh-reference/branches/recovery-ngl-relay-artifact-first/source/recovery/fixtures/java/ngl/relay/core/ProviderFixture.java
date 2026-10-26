package ngl.relay.core;
public final class ProviderFixture {
  static void eq(String a,String b){if(!a.equals(b))throw new AssertionError("expected="+b+" actual="+a);}
  public static void main(String[] args)throws Exception{
    OpenAiNode o=new OpenAiNode("openai","k","",""); eq(o.endpoint(),"https://api.openai.com/v1/chat/completions"); eq(o.requestBody("Hello"),"{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}");
    GrokNode g=new GrokNode("grok","k","",""); eq(g.endpoint(),"https://api.x.ai/v1/chat/completions");
    GeminiNode m=new GeminiNode("gemini","k","",""); eq(m.endpoint(),"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=k"); eq(m.requestBody("Hello"),"{\"contents\":[{\"parts\":[{\"text\":\"Hello\"}]}]}");
    ClaudeNode c=new ClaudeNode("claude","k","", "",null); eq(c.endpoint(),"https://api.anthropic.com/v1/messages"); eq(c.requestBody("Hello"),"{\"model\":\"claude-3-5-haiku-20241022\",\"max_tokens\":2048,\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}");
    if(MethodologyEngine.STAGE_5_SYNTHESIS!=5)throw new AssertionError(); System.out.println("provider fixtures: PASS");
  }
}
