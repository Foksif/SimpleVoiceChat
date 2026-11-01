//! Минимальный сервер голосовой комнаты: раздаёт сайт и работает как сигнальный сервер.
//!
//! Звук через сервер НЕ идёт: клиенты соединяются друг с другом по WebRTC
//! (Opus, шумоподавление, эхоподавление, jitter-буфер — всё это уже есть
//! в браузерном движке). Сервер только знакомит участников между собой:
//! держит список людей в единственной комнате и пересылает SDP/ICE.

use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tower_http::services::ServeDir;
use uuid::Uuid;

/// Для mesh-топологии (каждый с каждым) больше ~12 человек не стоит.
const MAX_PEERS: usize = 12;
const MAX_NAME_CHARS: usize = 24;

type Tx = UnboundedSender<Message>;

#[derive(Serialize, Clone)]
struct PeerInfo {
    id: String,
    name: String,
    muted: bool,
}

struct Peer {
    info: PeerInfo,
    tx: Tx,
}

#[derive(Default)]
struct Room {
    peers: HashMap<String, Peer>,
}

impl Room {
    fn broadcast_except(&self, except: &str, msg: &ServerMsg) {
        for (id, peer) in &self.peers {
            if id != except {
                send(&peer.tx, msg);
            }
        }
    }
}

type Shared = Arc<Mutex<Room>>;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Join { name: String },
    Signal { to: String, data: serde_json::Value },
    Update { muted: Option<bool> },
    Ping,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg {
    Welcome { id: String, peers: Vec<PeerInfo> },
    PeerJoined { peer: PeerInfo },
    PeerLeft { id: String },
    PeerUpdated { peer: PeerInfo },
    Signal { from: String, data: serde_json::Value },
    Error { message: String },
}

fn send(tx: &Tx, msg: &ServerMsg) {
    if let Ok(text) = serde_json::to_string(msg) {
        let _ = tx.send(Message::Text(text));
    }
}

fn sanitize_name(raw: &str) -> String {
    let name: String = raw.trim().chars().take(MAX_NAME_CHARS).collect();
    if name.is_empty() {
        "Гость".to_string()
    } else {
        name
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let room: Shared = Arc::default();
    // Собранный React-сайт (npm run build в client/) раздаём с того же порта.
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "../client/dist".into());
    tracing::info!("serving static files from {static_dir}");

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(|| async { "ok" }))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(room);

    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001u16);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    tracing::info!("voice server listening on {addr}");
    axum::serve(listener, app).await.expect("serve");
}

async fn ws_handler(ws: WebSocketUpgrade, State(room): State<Shared>) -> impl IntoResponse {
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, room))
}

async fn handle_socket(socket: WebSocket, room: Shared) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<Message>();

    // Отдельная задача пишет в сокет, чтобы можно было слать из любого места.
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let id = Uuid::new_v4().to_string();
    let mut joined = false;

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(parsed) = serde_json::from_str::<ClientMsg>(&text) else {
            continue;
        };

        match parsed {
            ClientMsg::Join { name } if !joined => {
                let mut r = room.lock().unwrap();
                if r.peers.len() >= MAX_PEERS {
                    send(
                        &tx,
                        &ServerMsg::Error {
                            message: "Комната заполнена".into(),
                        },
                    );
                    break;
                }
                let info = PeerInfo {
                    id: id.clone(),
                    name: sanitize_name(&name),
                    muted: false,
                };
                let others: Vec<PeerInfo> = r.peers.values().map(|p| p.info.clone()).collect();
                r.broadcast_except(&id, &ServerMsg::PeerJoined { peer: info.clone() });
                r.peers.insert(
                    id.clone(),
                    Peer {
                        info: info.clone(),
                        tx: tx.clone(),
                    },
                );
                send(&tx, &ServerMsg::Welcome { id: id.clone(), peers: others });
                tracing::info!("{} joined ({} in room)", info.name, r.peers.len());
                joined = true;
            }
            ClientMsg::Signal { to, data } if joined => {
                let r = room.lock().unwrap();
                if let Some(target) = r.peers.get(&to) {
                    send(&target.tx, &ServerMsg::Signal { from: id.clone(), data });
                }
            }
            ClientMsg::Update { muted } if joined => {
                let mut r = room.lock().unwrap();
                if let Some(peer) = r.peers.get_mut(&id) {
                    if let Some(m) = muted {
                        peer.info.muted = m;
                    }
                    let info = peer.info.clone();
                    r.broadcast_except(&id, &ServerMsg::PeerUpdated { peer: info });
                }
            }
            _ => {}
        }
    }

    if joined {
        let mut r = room.lock().unwrap();
        r.peers.remove(&id);
        r.broadcast_except(&id, &ServerMsg::PeerLeft { id: id.clone() });
        tracing::info!("peer left ({} in room)", r.peers.len());
    }
    drop(tx);
    let _ = writer.await;
}
