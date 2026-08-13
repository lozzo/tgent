//go:build js && wasm

package main

import (
	"sync"
	"syscall/js"

	"github.com/lozzo/tgent-client/client-go/clientcore"
)

var engines = struct {
	sync.Mutex
	next  uint32
	items map[uint32]*clientcore.Engine
}{next: 1, items: make(map[uint32]*clientcore.Engine)}

var exports []js.Func

func main() {
	api := js.Global().Get("Object").New()
	register(api, "abiVersion", func(js.Value, []js.Value) any { return 1 })
	register(api, "create", createEngine)
	register(api, "command", commandEngine)
	register(api, "nextEvent", nextEvent)
	register(api, "bridgeFrame", bridgeFrame)
	register(api, "nextBridgeFrame", nextBridgeFrame)
	register(api, "close", closeEngine)
	js.Global().Set("TgentGo", api)
	select {}
}

func register(api js.Value, name string, fn func(js.Value, []js.Value) any) {
	wrapped := js.FuncOf(fn)
	exports = append(exports, wrapped)
	api.Set(name, wrapped)
}

func createEngine(js.Value, []js.Value) any {
	engine, err := clientcore.NewEngine()
	if err != nil {
		return result(nil, err)
	}
	engines.Lock()
	id := engines.next
	engines.next++
	engines.items[id] = engine
	engines.Unlock()
	return result(id, nil)
}

func commandEngine(_ js.Value, args []js.Value) any {
	engine, err := engineArg(args)
	if err != nil {
		return result(nil, err)
	}
	payload := []byte(args[1].String())
	response, err := engine.Command(payload)
	if err != nil {
		return result(nil, err)
	}
	return result(string(response), nil)
}

func nextEvent(_ js.Value, args []js.Value) any {
	engine, err := engineArg(args)
	if err != nil {
		return result(nil, err)
	}
	event, err := engine.NextEvent(0)
	if err != nil {
		return result(nil, err)
	}
	return result(string(event), nil)
}

func bridgeFrame(_ js.Value, args []js.Value) any {
	engine, err := engineArg(args)
	if err != nil {
		return result(nil, err)
	}
	if len(args) < 2 || !args[1].InstanceOf(js.Global().Get("Uint8Array")) {
		return result(nil, &argumentError{"bridge frame must be Uint8Array"})
	}
	frame := make([]byte, args[1].Get("byteLength").Int())
	js.CopyBytesToGo(frame, args[1])
	return result(nil, engine.BridgeFrame(frame))
}

func nextBridgeFrame(_ js.Value, args []js.Value) any {
	engine, err := engineArg(args)
	if err != nil {
		return result(nil, err)
	}
	frame, err := engine.NextBridgeFrame(0)
	if err != nil {
		return result(nil, err)
	}
	if len(frame) == 0 {
		return result(nil, nil)
	}
	value := js.Global().Get("Uint8Array").New(len(frame))
	js.CopyBytesToJS(value, frame)
	return result(value, nil)
}

func closeEngine(_ js.Value, args []js.Value) any {
	if len(args) == 0 {
		return result(nil, &argumentError{"engine handle is required"})
	}
	id := uint32(args[0].Int())
	engines.Lock()
	engine := engines.items[id]
	delete(engines.items, id)
	engines.Unlock()
	if engine != nil {
		engine.Close()
	}
	return result(nil, nil)
}

func engineArg(args []js.Value) (*clientcore.Engine, error) {
	if len(args) == 0 || args[0].Type() != js.TypeNumber {
		return nil, &argumentError{"engine handle is required"}
	}
	engines.Lock()
	engine := engines.items[uint32(args[0].Int())]
	engines.Unlock()
	if engine == nil {
		return nil, &argumentError{"invalid engine handle"}
	}
	return engine, nil
}

func result(data any, err error) js.Value {
	value := js.Global().Get("Object").New()
	value.Set("ok", err == nil)
	if err != nil {
		value.Set("error", err.Error())
	} else if data != nil {
		value.Set("data", data)
	} else {
		value.Set("data", js.Null())
	}
	return value
}

type argumentError struct{ message string }

func (e *argumentError) Error() string { return e.message }
