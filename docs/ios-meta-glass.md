# Meta Ray-Ban Display integration (iOS)

How an iOS app renders content on Meta smart glasses with a display, via Meta's
**Device Access Toolkit (DAT)**.

## SDK

The DAT SDK is distributed as a Swift Package:

```
https://github.com/facebook/meta-wearables-dat-ios
```

Add it in Xcode via **File → Add Package Dependencies…**, then select the target.

## Rendering model

| Property | Behaviour |
|---|---|
| **Phone-driven** | The glasses hold no application state. The app builds a layout and pushes it; the glasses render what they receive. |
| **Full-view updates** | There are no partial updates. `send()` replaces the entire 600 × 600 px display surface. |
| **Session lifecycle** | The user must explicitly start or approve a display session before the app controls the display. Content can only be sent once the session state is `.started`. |
| **Rendering control** | The app controls layout and styling; the glasses only display it. |

Two consequences follow directly:

- **Animation cannot be streamed.** A smooth marquee would require a full-view
  update per frame over Bluetooth/Wi-Fi — impractical for bandwidth and battery,
  and visually flickery. Text that appears to scroll must instead be re-sent as
  discrete snapshots when its content changes.
- **Layouts are state, not DOM.** Each `send()` is a complete description, so the
  app is responsible for producing the next full layout.

## Sending a layout

```swift
import MetaWearablesDAT

func sendText(session: DisplaySession, text: String) {
    guard session.state == .started else { return }

    let layout = DisplayLayout(
        rootView: VStack {
            Text(text)
                .font(.heading)
                .textColor(.white)
        }
    )

    session.send(layout) { result in
        switch result {
        case .success:
            break
        case .failure(let error):
            print("display update failed: \(error.localizedDescription)")
        }
    }
}
```

## Design constraints

- **Target 600 × 600 px natively.** Dense paragraphs and small type are not
  legible; prefer short lines and bold headers.
- **Update on change, throttled.** Treat each `send()` as expensive.
- **Single-line content is a good fit.** A fixed-height line is predictable and
  can carry a continuous stream by re-sending a bounded window of recent items.
- **Input is event-based.** Touchpad gestures and Meta Neural Band input arrive
  as event handlers in the app, which can drive paging or selection.

## Testing

Meta ships **MockDeviceKit** in the SDK repository, which previews display
behaviour inside Xcode without hardware.

## References

- Display overview:
  <https://wearables.developer.meta.com/docs/develop/dat/display-overview/>
- SDK: <https://github.com/facebook/meta-wearables-dat-ios>
