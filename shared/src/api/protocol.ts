// Client -> Server
export const MSG_INPUT = 0x00
export const MSG_RESIZE = 0x01
export const MSG_PING = 0x02
// Send tmux key names instead of raw escape sequences for keys whose
// encoding depends on terminal mode (DECCKM, etc.). tmux knows the pane's
// actual terminal state and translates key names to the correct sequences.
export const MSG_SEND_KEYS = 0x03
export const MSG_AUTH = 0x04
export const MSG_CHALLENGE_RESP = 0x05
export const MSG_PROTOCOL_HELLO = 0x06
export const MSG_SNAPSHOT = 0x07
export const SNAPSHOT_FLAG_VIEWPORT_ONLY = 0x01

// Server -> Client
export const MSG_OUTPUT = 0x00
export const MSG_PANE_STATE = 0x01
export const MSG_PONG = 0x02
// Set when PONG is emitted by the terminal output worker. Older agents send an
// empty PONG, which only proves that the input/DataChannel handler is alive.
export const PONG_FLAG_OUTPUT_WORKER = 0x01
export const MSG_ERROR = 0x03
export const MSG_SESSION_EVENT = 0x04
export const MSG_PANE_INFO = 0x05
export const MSG_AUTH_RESULT = 0x06
export const MSG_PANE_STATE_CHUNK = 0x07
export const MSG_CHALLENGE = 0x08
export const MSG_TERMINAL_FRAME = 0x09
export const MSG_FRAME_CHUNK = 0x0a

// MsgPaneStateChunk flags
export const CHUNK_FLAG_FIRST = 0x01
export const CHUNK_FLAG_LAST = 0x02
