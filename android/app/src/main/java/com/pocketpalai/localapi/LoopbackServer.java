package com.pocketpal.localapi;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/** Deliberately small HTTP/1.1 subset: bounded bodies, no pipelining/chunking/browser access. */
public final class LoopbackServer implements AutoCloseable {
    public interface Handler { Reply handle(String path, String body) throws Exception; }
    public static final class Reply {
        public final int status;
        public final String body;
        public Reply(int status, String body) { this.status = status; this.body = body; }
    }
    private final ServerSocket listener;
    private final Handler handler;
    private final String token;
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new SynchronousQueue<>());
    private volatile boolean closed;
    public LoopbackServer(int port, Handler handler) throws IOException {
        this.handler = handler;
        byte[] secret = new byte[32]; new SecureRandom().nextBytes(secret);
        StringBuilder encoded = new StringBuilder();
        for (byte b : secret) encoded.append(String.format(Locale.ROOT, "%02x", b & 255));
        token = encoded.toString();
        listener = new ServerSocket();
        listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 8);
        Thread acceptor = new Thread(this::accept, "local-api-listener");
        acceptor.setDaemon(true); acceptor.start();
    }
    public String token() { return token; }
    public int port() { return listener.getLocalPort(); }
    private void accept() {
        while (!closed) {
            try {
                Socket s = listener.accept();
                s.setSoTimeout(3000); sockets.add(s);
                try { workers.execute(() -> serve(s)); }
                catch (RejectedExecutionException e) { sockets.remove(s); s.close(); }
            } catch (IOException e) { if (!closed) close(); }
        }
    }
    private static final class Rejected extends Exception {
        final int status; Rejected(int status) { this.status = status; }
    }
    private void serve(Socket socket) {
        try (Socket s = socket) {
            Reply reply;
            try { reply = readRequest(s); }
            catch (Rejected e) { reply = error(e.status); }
            catch (Exception e) { reply = error(500); }
            byte[] body = reply.body.getBytes(StandardCharsets.UTF_8);
            OutputStream out = s.getOutputStream();
            out.write(("HTTP/1.1 " + reply.status + " Response\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.write(body); out.flush();
        } catch (IOException ignored) { /* No secrets or prompts in logs. */ }
        finally { sockets.remove(socket); }
    }
    private Reply readRequest(Socket s) throws Exception {
        InputStream in = s.getInputStream();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int match = 0;
        byte[] end = {13, 10, 13, 10};
        while (match != 4) {
            if (head.size() >= 8192 || System.nanoTime() > deadline) throw new Rejected(431);
            int b = in.read(); if (b < 0) throw new Rejected(400);
            head.write(b); match = b == end[match] ? match + 1 : (b == 13 ? 1 : 0);
        }
        String[] lines = head.toString("US-ASCII").split("\r\n");
        String[] first = lines[0].split(" ", -1);
        if (first.length != 3 || !first[2].equals("HTTP/1.1")) throw new Rejected(400);
        Map<String,String> headers = new HashMap<>();
        if (lines.length > 65) throw new Rejected(431);
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) throw new Rejected(400);
            String name = lines[i].substring(0, colon);
            if (!name.matches("[A-Za-z0-9-]+")) throw new Rejected(400);
            name = name.toLowerCase(Locale.ROOT);
            String value = lines[i].substring(colon + 1).trim();
            if (value.chars().anyMatch(c -> c < 32 || c > 126) || headers.put(name, value) != null) throw new Rejected(400);
        }
        if (!headers.getOrDefault("host", "").equals("127.0.0.1:" + port())) throw new Rejected(403);
        if (headers.containsKey("origin") || headers.containsKey("sec-fetch-site")) throw new Rejected(403);
        byte[] supplied = headers.getOrDefault("authorization", "").getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(supplied, ("Bearer " + token).getBytes(StandardCharsets.US_ASCII))) throw new Rejected(401);
        if (headers.containsKey("transfer-encoding") || headers.containsKey("expect")) throw new Rejected(400);
        String length = headers.getOrDefault("content-length", "0");
        if (!length.matches("[0-9]{1,6}")) throw new Rejected(400);
        int size = Integer.parseInt(length);
        if (size > 32768) throw new Rejected(413);
        if (first[0].equals("GET") && first[1].equals("/v1/models") && size == 0) return handler.handle(first[1], "");
        if (!first[0].equals("POST") || !first[1].equals("/v1/chat/completions")) throw new Rejected(404);
        if (!headers.getOrDefault("content-type", "").split(";", 2)[0].trim().equalsIgnoreCase("application/json")) throw new Rejected(415);
        if (size == 0) throw new Rejected(400);
        byte[] body = new byte[size]; int read = 0;
        while (read < size) {
            if (System.nanoTime() > deadline) throw new Rejected(408);
            int n = in.read(body, read, size - read); if (n < 0) throw new Rejected(400); read += n;
        }
        return handler.handle(first[1], new String(body, StandardCharsets.UTF_8));
    }
    private static Reply error(int code) { return new Reply(code, "{\"error\":{\"message\":\"Request rejected\",\"type\":\"local_api_error\"}}"); }
    @Override public void close() {
        closed = true;
        try { listener.close(); } catch (IOException ignored) {}
        for (Socket s : sockets) try { s.close(); } catch (IOException ignored) {}
        workers.shutdownNow();
    }
}
