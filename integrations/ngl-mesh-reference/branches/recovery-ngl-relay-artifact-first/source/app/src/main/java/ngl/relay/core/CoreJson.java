package ngl.relay.core;
import java.nio.charset.StandardCharsets; import java.security.MessageDigest; import java.util.*;
public final class CoreJson {
  private CoreJson(){}
  public static final class JObject {
    private final LinkedHashMap<String,Object> m=new LinkedHashMap<>();
    public String get(String k){Object v=m.get(k);return v==null||v instanceof String?(String)v:null;}
    public Boolean getBool(String k){Object v=m.get(k);return v instanceof Boolean?(Boolean)v:null;}
    public boolean getBool(String k,boolean d){Boolean v=getBool(k);return v==null?d:v.booleanValue();}
    public List<String> getList(String k){Object v=m.get(k);if(!(v instanceof List))return null;List<String>out=new ArrayList<>();for(Object x:(List<?>)v)out.add(x==null?null:x.toString());return out;}
    public Double getNum(String k){Object v=m.get(k);return v instanceof Double?(Double)v:null;}
    public double getNum(String k,double d){Double v=getNum(k);return v==null?d:v.doubleValue();}
    public JObject getObject(String k){Object v=m.get(k);return v instanceof JObject?(JObject)v:null;}
    public List<JObject> getObjectList(String k){Object v=m.get(k);if(!(v instanceof List))return null;List<JObject>out=new ArrayList<>();for(Object x:(List<?>)v)if(x instanceof JObject)out.add((JObject)x);return out;}
    public boolean has(String k){return m.containsKey(k);} public Set<String> keys(){return m.keySet();} public void put(String k,Object v){m.put(k,v);}
  }
  private static final class Parser {
    private final String s; private int i; Parser(String s){this.s=s;}
    void ws(){while(i<s.length()){char c=s.charAt(i);if(c==' '||c=='\n'||c=='\r'||c=='\t')i++;else break;}}
    char peek(){return i<s.length()?s.charAt(i):'\0';} char next(){if(i>=s.length())throw err("unexpected end");return s.charAt(i++);} IllegalArgumentException err(String m){return new IllegalArgumentException(m+" at "+i);}
    Object parse(){ws();Object v=value();ws();if(i!=s.length())throw err("trailing json");return v;}
    Object value(){ws();if(i>=s.length())throw err("unexpected end");char c=peek();if(c=='{')return object();if(c=='[')return array();if(c=='\"')return string();if(s.startsWith("true",i)){i+=4;return Boolean.TRUE;}if(s.startsWith("false",i)){i+=5;return Boolean.FALSE;}if(s.startsWith("null",i)){i+=4;return null;}return number();}
    JObject object(){if(next()!='{')throw err("expected object");JObject o=new JObject();ws();if(peek()=='}'){i++;return o;}for(;;){ws();String k=string();ws();if(next()!=':')throw err("expected :");o.put(k,value());ws();char c=next();if(c=='}')return o;if(c!=',')throw err("expected , or }");}}
    List<Object> array(){if(next()!='[')throw err("expected array");List<Object>a=new ArrayList<>();ws();if(peek()==']'){i++;return a;}for(;;){a.add(value());ws();char c=next();if(c==']')return a;if(c!=',')throw err("expected , or ]");}}
    Double number(){int st=i;if(peek()=='-')i++;while(i<s.length()&&Character.isDigit(peek()))i++;if(peek()=='.'){i++;while(i<s.length()&&Character.isDigit(peek()))i++;}if(peek()=='e'||peek()=='E'){i++;if(peek()=='+'||peek()=='-')i++;while(i<s.length()&&Character.isDigit(peek()))i++;}try{return Double.valueOf(s.substring(st,i));}catch(Exception e){throw err("bad number");}}
    String string(){if(next()!='\"')throw err("expected string");StringBuilder b=new StringBuilder();while(i<s.length()){char c=next();if(c=='\"')return b.toString();if(c!='\\'){b.append(c);continue;}char e=next();switch(e){case'\"':b.append('\"');break;case'\\':b.append('\\');break;case'/':b.append('/');break;case'b':b.append('\b');break;case'f':b.append('\f');break;case'n':b.append('\n');break;case'r':b.append('\r');break;case't':b.append('\t');break;case'u':if(i+4>s.length())throw err("bad unicode");try{b.append((char)Integer.parseInt(s.substring(i,i+4),16));}catch(Exception x){throw err("bad unicode");}i+=4;break;default:throw err("bad escape");}}throw err("expected string");}
  }
  @SuppressWarnings("unchecked") public static List<Object> parseArray(String s){Object o=new Parser(s).parse();if(o instanceof List)return (List<Object>)o;throw new IllegalArgumentException("not a JSON array");}
  public static JObject parseObject(String s){if(s==null)throw new IllegalArgumentException("null json");Object o=new Parser(s).parse();if(o instanceof JObject)return (JObject)o;throw new IllegalArgumentException("not a JSON object");}
  public static String sha256Hex(String s){try{byte[]d=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder(64);for(byte x:d){int v=x&0xff;b.append(Character.forDigit((v>>>4)&15,16));b.append(Character.forDigit(v&15,16));}return b.toString();}catch(Exception e){throw new IllegalStateException(e);}}
  public static void obj(StringBuilder b,String k,String v){b.append('"').append(k).append("\":");str(b,v);} public static void str(StringBuilder b,String s){if(s==null){b.append("null");return;}b.append('"');for(int i=0;i<s.length();i++){char c=s.charAt(i);switch(c){case'\\':b.append("\\\\");break;case'"':b.append("\\\"");break;case'\r':b.append("\\r");break;case'\f':b.append("\\f");break;case'\n':b.append("\\n");break;case'\t':b.append("\\t");break;case'\b':b.append("\\b");break;default:if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}}b.append('"');}
}
