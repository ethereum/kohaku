# @kohaku-eth/webtor

Tor integration for browsers via WebAssembly. Make anonymous HTTP/HTTPS requests through Tor using Snowflake (WebRTC) and WebTunnel bridges—no server proxy needed.

## Installation

```bash
pnpm add @kohaku-eth/webtor
```

## Usage

```typescript
import { TorClient, TorClientOptions, init } from "@kohaku-eth/webtor"

// Initialize WASM module
await init()

// Create client with Snowflake WebRTC (most censorship-resistant)
const client = await TorClient.create(TorClientOptions.snowflakeWebRtc())

// Make anonymous requests through Tor
const response = await client.fetch("https://check.torproject.org/")
console.log(response.text())

// Clean up
await client.close()
```

## Transport Options

```typescript
// Snowflake via WebRTC (default, most censorship-resistant)
TorClientOptions.snowflakeWebRtc()

// Snowflake via direct WebSocket
new TorClientOptions(snowflakeUrl)

// WebTunnel (HTTPS, works through corporate proxies)
TorClientOptions.webtunnel(url, fingerprint)
```

## Configuration

```typescript
const options = TorClientOptions.snowflakeWebRtc()
  .withConnectionTimeout(30000)  // Connection timeout in ms
  .withCircuitTimeout(60000)     // Circuit build timeout in ms
```

## API

### `init()`
Initialize the WASM module. Must be called before creating a client.

### `TorClient.create(options)`
Create a new Tor client with the specified options.

### `client.fetch(url)`
Make an anonymous HTTP request through Tor. Returns a `JsHttpResponse`.

### `client.close()`
Close the client and release resources.

### `setDebugEnabled(enabled)`
Enable/disable debug logging.

### `setLogCallback(callback)`
Set a callback function to receive log messages.

## How It Works

1. **Snowflake/WebTunnel** connects to a Tor bridge using WebRTC or HTTPS
2. **Tor Protocol** builds a 3-hop circuit through the Tor network
3. **Exit Relay** makes the actual HTTP request on your behalf
4. Response travels back through the circuit, encrypted at each hop

All traffic is anonymized—the destination sees the exit relay's IP, not yours.

## License

MIT
