package main

/*
#include <stdint.h>
#include <stdlib.h>
typedef struct tgent_buffer_v1 {
  uint64_t buffer_handle;
  const uint8_t *data;
  size_t length;
} tgent_buffer_v1;
*/
import "C"

import (
	"sync"
	"time"
	"unsafe"

	"github.com/lozzo/tgent/client-go/clientcore"
)

const (
	statusOK              = 0
	statusInvalidArgument = 1
	statusInvalidHandle   = 2
	statusInternal        = 4
)

var registry = struct {
	sync.Mutex
	next    uint64
	engines map[uint64]*clientcore.Engine
	buffers map[uint64]unsafe.Pointer
}{next: 1, engines: make(map[uint64]*clientcore.Engine), buffers: make(map[uint64]unsafe.Pointer)}

//export tgent_client_abi_version
func tgent_client_abi_version() C.uint32_t { return 1 }

//export tgent_engine_create
func tgent_engine_create(out *C.uint64_t) C.int {
	if out == nil {
		return statusInvalidArgument
	}
	e, err := clientcore.NewEngine()
	if err != nil {
		return statusInternal
	}
	registry.Lock()
	id := registry.next
	registry.next++
	registry.engines[id] = e
	registry.Unlock()
	*out = C.uint64_t(id)
	return statusOK
}

func engine(id uint64) *clientcore.Engine {
	registry.Lock()
	defer registry.Unlock()
	return registry.engines[id]
}

func output(data []byte, out *C.tgent_buffer_v1) C.int {
	if out == nil {
		return statusInvalidArgument
	}
	if len(data) == 0 {
		out.buffer_handle = 0
		out.data = nil
		out.length = 0
		return statusOK
	}
	p := C.CBytes(data)
	registry.Lock()
	id := registry.next
	registry.next++
	registry.buffers[id] = p
	registry.Unlock()
	out.buffer_handle = C.uint64_t(id)
	out.data = (*C.uint8_t)(p)
	out.length = C.size_t(len(data))
	return statusOK
}

//export tgent_engine_command
func tgent_engine_command(id C.uint64_t, data *C.uint8_t, length C.size_t, out *C.tgent_buffer_v1) C.int {
	e := engine(uint64(id))
	if e == nil {
		return statusInvalidHandle
	}
	if data == nil && length > 0 {
		return statusInvalidArgument
	}
	payload := C.GoBytes(unsafe.Pointer(data), C.int(length))
	resp, err := e.Command(payload)
	if err != nil {
		return statusInternal
	}
	return output(resp, out)
}

//export tgent_engine_next_event
func tgent_engine_next_event(id C.uint64_t, timeout C.uint32_t, out *C.tgent_buffer_v1) C.int {
	e := engine(uint64(id))
	if e == nil {
		return statusInvalidHandle
	}
	event, err := e.NextEvent(time.Duration(timeout) * time.Millisecond)
	if err != nil {
		return statusInternal
	}
	return output(event, out)
}

//export tgent_engine_bridge_port
func tgent_engine_bridge_port(id C.uint64_t, out *C.uint16_t) C.int {
	e := engine(uint64(id))
	if e == nil {
		return statusInvalidHandle
	}
	if out == nil {
		return statusInvalidArgument
	}
	*out = C.uint16_t(e.BridgePort())
	return statusOK
}

//export tgent_engine_close
func tgent_engine_close(id C.uint64_t) C.int {
	registry.Lock()
	e := registry.engines[uint64(id)]
	delete(registry.engines, uint64(id))
	registry.Unlock()
	if e == nil {
		return statusInvalidHandle
	}
	e.Close()
	return statusOK
}

//export tgent_buffer_free
func tgent_buffer_free(id C.uint64_t) C.int {
	if id == 0 {
		return statusOK
	}
	registry.Lock()
	p := registry.buffers[uint64(id)]
	delete(registry.buffers, uint64(id))
	registry.Unlock()
	if p == nil {
		return statusInvalidHandle
	}
	C.free(p)
	return statusOK
}

func main() {}
