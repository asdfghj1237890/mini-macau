import { BusWorkerRuntime, type BusWorkerRequest } from './busWorkerRuntime'

const runtime = new BusWorkerRuntime()
self.onmessage = (event: MessageEvent<BusWorkerRequest>) => {
  self.postMessage(runtime.sample(event.data))
}
