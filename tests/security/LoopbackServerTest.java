import com.pocketpal.localapi.LoopbackServer;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

public class LoopbackServerTest {
    private static int checks;
    private static String send(LoopbackServer s, String request) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", s.port())) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            socket.shutdownOutput();
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }
    private static void status(String response, int code) {
        if (!response.startsWith("HTTP/1.1 " + code + " ")) throw new AssertionError("Expected " + code + ": " + response);
        checks++;
    }
    public static void main(String[] args) throws Exception {
        AtomicInteger calls = new AtomicInteger();
        String previous;
        try (LoopbackServer s = new LoopbackServer(0, (path, body) -> { calls.incrementAndGet(); return new LoopbackServer.Reply(200, "{\"ok\":true}"); })) {
            previous = s.token();
            if (!previous.matches("[a-f0-9]{64}")) throw new AssertionError("Bad token");
            String host = "Host: 127.0.0.1:" + s.port() + "\r\n";
            String auth = "Authorization: Bearer " + s.token() + "\r\n";
            String get = "GET /v1/models HTTP/1.1\r\n";
            status(send(s, get + host + "\r\n"), 401);
            status(send(s, get + host + "Authorization: Bearer wrong\r\n\r\n"), 401);
            status(send(s, get + host + auth + "\r\n"), 200);
            status(send(s, get + "Host: evil.example\r\n" + auth + "\r\n"), 403);
            status(send(s, get + host + auth + "Origin: null\r\n\r\n"), 403);
            status(send(s, get + host + auth + "Sec-Fetch-Site: same-origin\r\n\r\n"), 403);
            status(send(s, get + host + auth + auth + "\r\n"), 400);
            status(send(s, get + host + auth + "Transfer-Encoding: chunked\r\n\r\n"), 400);
            status(send(s, "POST /v1/chat/completions HTTP/1.1\r\n" + host + auth + "Content-Length: 40000\r\n\r\n"), 413);
            status(send(s, "POST /v1/chat/completions HTTP/1.1\r\n" + host + auth + "Content-Type: text/plain\r\nContent-Length: 2\r\n\r\n{}"), 415);
            status(send(s, "POST /v1/chat/completions HTTP/1.1\r\n" + host + auth + "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"), 200);
            status(send(s, "GET /logs HTTP/1.1\r\n" + host + auth + "\r\n"), 404);
            status(send(s, get + host + auth + "X-Fill: " + "a".repeat(8192) + "\r\n\r\n"), 431);
            status(send(s, get + host + auth + "Content-Length: 0\r\nContent-Length: 0\r\n\r\n"), 400);
            status(send(s, "POST /v1/chat/completions HTTP/1.1\r\n" + host + auth + "Content-Type: application/json\r\nContent-Length: 4\r\n\r\n{}"), 400);
            if (calls.get() != 2) throw new AssertionError("Rejected request reached handler");
        }
        try (LoopbackServer s = new LoopbackServer(0, (p,b) -> new LoopbackServer.Reply(200,"{}"))) {
            if (previous.equals(s.token())) throw new AssertionError("Reused session key");
            status(send(s, "GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:"+s.port()+"\r\nAuthorization: Bearer "+previous+"\r\n\r\n"), 401);
        }
        System.out.println(checks + " HTTP security checks passed; rejected requests never reached handler; session key rotated.");
    }
}
