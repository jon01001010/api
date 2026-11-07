//! TEST ONLY (not part of the phone app): drives the phone side from a
//! terminal, to test it against the real desktop app.
//!
//!   homelink-test pair <qr text> <phone name>
//!   homelink-test status <pc key>
//!   homelink-test tunnel <pc key>     (opens the local port and waits)
//!
//! KEY_FILE (default /tmp/homelink-test.key) is the phone's key; PC_ADDR
//! (ip:port) gives the PC's address where relays are out of reach.
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let key = std::env::var("KEY_FILE").unwrap_or_else(|_| "/tmp/homelink-test.key".into());
    let hint = std::env::var("PC_ADDR").ok().and_then(|a| a.parse().ok());
    let phone = Arc::new(homelink::Phone::new(std::path::Path::new(&key), hint).expect("start"));
    println!("phone key {}", phone.id());
    match args.get(1).map(String::as_str) {
        Some("pair") => println!("pair: {:?}", phone.pair(&args[2], &args[3])),
        Some("status") => println!("status: {:?}", phone.status(&args[2])),
        Some("tunnel") => {
            let port = phone.open_tunnel(&args[2]).expect("tunnel");
            println!("tunnel on 127.0.0.1:{port}");
            std::thread::sleep(std::time::Duration::from_secs(
                std::env::var("WAIT").ok().and_then(|w| w.parse().ok()).unwrap_or(120),
            ));
        }
        _ => eprintln!("pair | status | tunnel"),
    }
}
