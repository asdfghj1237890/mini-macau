import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'
import { createAircraftMesh } from './aircraftMesh'

export { vehicleInstances as aircraftInstances } from './InstancedVehicleModelLayer'

const MESH = createAircraftMesh()

export class AircraftModelLayer extends InstancedVehicleModelLayer {
  constructor(minZoom: number) {
    super({ id: 'flight-3d-model', minZoom, mesh: MESH, label: 'aircraft' })
  }
}
