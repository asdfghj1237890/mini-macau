import { BusWorkerRuntime, type BusWorkerRequest } from './busWorkerRuntime'

const runtime = new BusWorkerRuntime()
self.onmessage = (event: MessageEvent<BusWorkerRequest>) => {
  const reply = runtime.sample(event.data)
  self.postMessage(reply, { transfer: reply.trace?.paths.map(path => path.points.buffer) ?? [] })
}
