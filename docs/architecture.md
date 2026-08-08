# Architecture

## Current Milestone

The current implementation is the TUI tracer bullet defined by section 44 of `PI_LEARNING_AGENT_IMPLEMENTATION_SPEC.md`.

The extension has five boundaries:

1. `LearningStateStore` owns learning-mode state.
2. Learning Tools translate model parameters into typed interactions and translate resolved answers into Pi tool results.
3. Session persistence restores snapshots from the active Pi branch.
4. TUI presenters own learner-facing input through Pi's `ctx.ui` API.
5. `InteractionBroker` owns pending Promise lifecycle for both the current TUI path and the future Web transport.

Tool answers never call `pi.sendUserMessage()`. They resolve the current tool execution. The only `sendUserMessage()` call is the user-initiated `/learn` kickoff.

## Protocol Invariants

- Interaction IDs are unique.
- Answers are discriminated by interaction type.
- Single-choice answers must reference an option owned by the interaction.
- Code answer language must match the requested language.
- Response time uses the server/runtime clock, not `clientTimestamp`.
- Resolved, cancelled, and aborted interactions are removed from the pending map.
- Blocking Learning Tools execute sequentially.

## Current Interaction Path

```text
Tool execute
  -> broker.present
  -> TUI presenter
  -> broker.submit
  -> structured tool result
```

## Next Transport

The Web milestone can implement a presenter backed by `InteractionBroker.present()` while keeping the Tool interface unchanged:

```text
Tool execute
  -> presenter(interaction, signal, ctx)
  -> InteractionBroker.present
  -> SSE interaction.presented
  -> browser POST submission
  -> InteractionBroker.submit
  -> structured tool result
```

The server must bind to `127.0.0.1`, generate a random bearer token, enforce body limits, and cancel all pending work during shutdown.
