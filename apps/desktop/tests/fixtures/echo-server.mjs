import { createServer } from 'node:http'

// Minimal HTTP server for server-supervisor tests: listens on the port given
// as argv[2], answers every request, and runs until the parent kills it.
const port = Number(process.argv[2])
createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
}).listen(port, '127.0.0.1')
