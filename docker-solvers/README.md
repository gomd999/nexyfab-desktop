# Σ Simulation Docker Solvers

This directory contains Dockerfile templates + REST shim specs for wiring real OSS solvers behind the NexyFab `Σ` adapter contract. Mock adapters in `src/lib/ai/scad-agent/simulationAdapters.ts` are the dev-time stand-in; these Docker images are the production swap-in.

## Switching at runtime

Set `NEXYFAB_SIM_BACKEND=docker` and (optionally) override container URLs:

```
NEXYFAB_SIM_BACKEND=docker
NEXYFAB_SIM_URL_CFD=http://cfd-svc:8101
NEXYFAB_SIM_URL_MBD=http://mbd-svc:8102
NEXYFAB_SIM_URL_CAM=http://cam-svc:8103
NEXYFAB_SIM_URL_MOLD_FILL=http://mold-svc:8104
NEXYFAB_SIM_URL_OPTICS=http://optics-svc:8105
NEXYFAB_SIM_URL_THERMAL=http://thermal-svc:8106
```

Without `NEXYFAB_SIM_BACKEND=docker`, the API falls back to the mock adapters (no Docker required).

## REST contract every container must implement

```
POST /solve
  body: { input: <Sim*Input> }       # the same shape the agent sends
  → 200 { jobId: "<uuid>", status: "queued" }

GET /jobs/:id
  → 200 {
      jobId: "<uuid>",
      status: "queued" | "running" | "done" | "failed",
      progress: 0..1,                # optional
      result?: <Sim*Output>,         # required when status === "done"
      error?: string                 # required when status === "failed"
    }
```

The container is responsible for:
- Persisting the job (memory or disk; in-process is fine for single-replica)
- Running the OSS solver (OpenFOAM / Chrono / OpenCAMLib / etc.)
- Translating the solver's output to `Sim*Output` shape (see `src/lib/ai/scad-agent/simulationAdapters.ts` for the canonical types)

## Container quick-start templates

| Kind        | Solver        | Image base          | Port  | Heavy deps                |
|-------------|---------------|---------------------|-------|---------------------------|
| `cfd`       | OpenFOAM      | `opencfd/openfoam`  | 8101  | ~2.5 GB image             |
| `mbd`       | Project Chrono| `projectchrono/chrono` | 8102  | ~1.8 GB                   |
| `cam`       | OpenCAMLib    | `gnea/grbl-base`    | 8103  | ~600 MB                   |
| `mold_fill` | OpenMolde     | `openmolde/runtime` | 8104  | ~1.2 GB                   |
| `optics`    | POV-Ray       | `povray/povray`     | 8105  | ~400 MB                   |
| `thermal`   | OpenFOAM (chtMultiRegionFoam) | `opencfd/openfoam` | 8106 | reuses CFD base |

## Sketch: CFD container Dockerfile

```dockerfile
# Dockerfile.cfd
FROM opencfd/openfoam-default:2312

# Tiny REST shim (Python is fine; FastAPI gives async + OpenAPI for free).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install fastapi uvicorn pydantic

COPY shims/cfd/ /opt/shim/
WORKDIR /opt/shim
EXPOSE 8101
ENV PORT=8101
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8101"]
```

## Sketch: shim main.py (CFD)

```python
# shims/cfd/main.py
import subprocess, uuid, threading
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
JOBS = {}

class CfdInput(BaseModel):
    brepHandle: str
    velocityMs: float
    fluid: str
    referenceLengthMm: float

@app.post("/solve")
async def solve(body: dict):
    jobId = str(uuid.uuid4())
    JOBS[jobId] = {"jobId": jobId, "status": "queued", "progress": 0.0}
    threading.Thread(target=run_openfoam, args=(jobId, body["input"]), daemon=True).start()
    return {"jobId": jobId, "status": "queued"}

@app.get("/jobs/{jobId}")
async def get_job(jobId: str):
    return JOBS.get(jobId, {"jobId": jobId, "status": "failed", "error": "unknown job"})

def run_openfoam(jobId, input_):
    JOBS[jobId]["status"] = "running"
    try:
        # ... run simpleFoam against a templated case directory ...
        # ... parse forces/cd from postProcessing/forceCoeffs ...
        result = {
            "reynolds": 1e5,
            "regime": "turbulent",
            "dragCoefficient": 0.21,
            "notes": "OpenFOAM simpleFOAM",
        }
        JOBS[jobId].update({"status": "done", "result": result, "progress": 1.0})
    except Exception as e:
        JOBS[jobId].update({"status": "failed", "error": str(e)})
```

## Deployment notes

- **Railway**: each solver = one service. Set the corresponding `NEXYFAB_SIM_URL_*` to the service's internal Railway URL.
- **Self-hosted**: docker-compose in this directory should map services to ports 8101-8106 on a shared bridge network. The Next.js app reaches them via `http://<service-name>:<port>`.
- **Cost**: OpenFOAM jobs can run minutes; bill via the existing `sim_run` quota (Pro=20/mo, Team=100/mo) before charging cluster time.

## Status

| Kind | Adapter contract | Mock | Real Docker |
|------|------------------|------|-------------|
| cfd  | ✅ | ✅ | ⛏ template only |
| mbd  | ✅ | ✅ | ⛏ template only |
| cam  | ✅ | ✅ | ⛏ template only |
| mold_fill | ✅ | ✅ | ⛏ template only |
| optics | ✅ | ✅ | ⛏ template only |
| thermal | ✅ | ✅ | ⛏ template only |

Real Docker images live outside this repo (image weights). To build: see each solver's official OSS Dockerfile + thread the REST shim above.
