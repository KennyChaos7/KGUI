package main

import (
	"log"

	"github.com/egoist/mygo"
)

var AgentStream = mygo.NewEvent[AgentEvent]("agent_event")

func main() {
	var window *mygo.Window
	service := &AgentService{emit: func(event AgentEvent) {
		if window != nil {
			_ = AgentStream.Emit(window, event)
		}
	}}
	mygo.Bind(service)

	mygo.App.WhenReady(func() {
		window = mygo.NewWindow(mygo.WindowOptions{
			Title:           "KGUI",
			Width:           1180,
			Height:          800,
			MinWidth:        800,
			MinHeight:       600,
			BackgroundColor: "#111319",
			// The frontend: devUrl during `mygo dev`, frontendDist
			// embedded by `mygo build` otherwise (see mygo.json).
			URL: "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Print(err)
	}
	if err := service.close(); err != nil {
		log.Print(err)
	}
}
