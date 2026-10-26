package ngl.relay.core;
import java.text.*; import java.util.*;
public final class Iso8601 {
  private static final TimeZone UTC=TimeZone.getTimeZone("UTC"); private Iso8601(){}
  private static SimpleDateFormat newFormat(){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);f.setTimeZone(UTC);f.setLenient(false);return f;}
  public static String now(){return newFormat().format(new Date());}
  public static String of(long millis){return newFormat().format(new Date(millis));}
  public static long parse(String s){try{return newFormat().parse(s).getTime();}catch(ParseException e){throw new IllegalArgumentException("not ISO-8601: "+s,e);}}
}
