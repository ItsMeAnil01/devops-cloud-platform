# How This Project Actually Works

This file explains what's happening under the hood at every stage — useful both for your own understanding and for answering follow-up interview questions.

---

## 1. The Application

A minimal Express API with three endpoints:

- `/health` — used by Kubernetes probes to decide if the pod is alive and ready for traffic. Returns `200 {"status":"ok"}` normally.
- `/api/status` — returns metadata about the running instance (env, version, pod hostname). Useful for proving load is spread across multiple pods.
- `/api/users` — a fake in-memory "database" endpoint, just to have something resembling a real API.

Tests (`app/tests/server.test.js`) use Jest + Supertest to hit these endpoints without actually starting a network listener — `server.js` only calls `app.listen()` when run directly (`require.main === module`), so the test file can `require()` the app and test it in-process. This is why tests run in milliseconds and don't need port cleanup.

---

## 2. The Dockerfile

Key design choices:

- **`node:20-alpine`** — small base image, faster pulls, smaller attack surface.
- **Dependencies copied and installed before the rest of the code** — Docker caches layers, so if you only change `server.js` (not `package.json`), the `npm install` layer is reused and builds are much faster.
- **Non-root user (`appuser`)** — the container doesn't run as root, a basic but important security practice; a compromised process has fewer privileges to escalate with.
- **`HEALTHCHECK` instruction** — lets `docker ps` and Docker Desktop show container health directly, independent of Kubernetes' own probes.

---

## 3. CI/CD Pipeline (`.github/workflows/ci-cd.yml`)

Two jobs, chained with `needs: test`:

1. **`test`** — checks out code, installs Node, runs `npm test`. If this fails, the pipeline stops here — nothing broken ever reaches the build stage.
2. **`build-and-push`** — only runs on pushes to `main` (not on pull requests, via the `if:` condition — you don't want every PR from an untrusted branch pushing images). Uses Docker Buildx to build for **both `linux/amd64` and `linux/arm64`** in one step, tags the image `latest` and with the commit SHA (so you always have an immutable reference to exactly which commit built which image), then pushes to Docker Hub.

### Why multi-platform builds matter

Apple Silicon Macs run `arm64`. Most CI runners (including GitHub's default `ubuntu-latest`) build `amd64` images. If you only build for `amd64` and try to run that image on an `arm64` Kubernetes node (like a local Kind cluster on an M-series Mac), you get:

```
no match for platform in manifest: not found
```

Buildx with `platforms: linux/amd64,linux/arm64` solves this by building (and pushing) a **manifest list** — a single tag that actually points to two different images, one per architecture. Docker/Kubernetes automatically pulls the one matching the host's CPU.

---

## 4. Kubernetes Objects

### Deployment
Declares "I want N replicas of this pod running, using this image." If a pod dies, the Deployment's controller loop notices the actual state (N-1 pods) doesn't match desired state (N pods) and creates a replacement. This reconciliation loop is the core idea behind almost everything Kubernetes does.

### Service (NodePort)
Pods have IP addresses that change every time they're recreated — nothing should talk to a pod directly. The Service gives a stable virtual IP and DNS name (`devops-demo-service`) and load-balances traffic across whichever pods currently match its label selector. `NodePort` additionally exposes it on a fixed port (`30080`) on the node itself, which is how you can `curl localhost:30080` from your Mac into the Kind cluster.

### ConfigMap / Secret
Both inject environment variables into the container. The only real difference: Secrets are base64-encoded at rest and Kubernetes handles them with slightly more care (not printed in `kubectl describe` by default, separate RBAC permissions possible). In this demo the "secret" values aren't real secrets — the point is to demonstrate the mechanism you'd use for a real database password or API key.

### Liveness vs Readiness probes
- **Readiness** — "should this pod receive traffic right now?" If it fails, the pod is removed from the Service's load-balancing pool, but is *not* killed. Used during startup or temporary overload.
- **Liveness** — "is this pod fundamentally broken and needs a restart?" If it fails repeatedly (`failureThreshold`), Kubernetes kills and restarts the container.

This is why, in the broken-deployment demo, the new pod kept restarting (liveness failing) while never being added to the Service (readiness failing) — and your old pods kept serving traffic the whole time.

### HPA (Horizontal Pod Autoscaler)
Polls resource metrics (via metrics-server) every ~15 seconds and compares actual CPU utilization against a target percentage of the pod's *requested* CPU (not limit). If usage exceeds the target for a sustained period, it increases replica count (up to `maxReplicas`); if usage drops, it scales back down, but more conservatively (a stabilization window prevents flapping).

---

## 5. Helm

Helm doesn't do anything Kubernetes can't already do — it's a templating and release-management layer on top of `kubectl apply`. Benefits actually demonstrated in this project:

- **`values.yaml`** — a single place to change replica count, image tag, resource limits, etc., instead of editing YAML in five different files.
- **Release tracking** — `helm list` shows you exactly what's deployed and its revision number.
- **`helm rollback`** — reverts to a previous revision's exact rendered manifests in one command. This is what saved you in the broken-deployment demo.
- **Conditional templates** — `{{- if .Values.autoscaling.enabled }}` in `hpa.yaml` means the HPA resource is only created at all if you've turned it on in values, without needing a separate file to delete/apply manually.

---

## 6. Monitoring Stack (kube-prometheus-stack)

This one Helm chart installs:

- **Prometheus** — scrapes metrics from Kubernetes itself (via `kube-state-metrics`), each node (`node-exporter`), and any pod/service annotated for scraping. Stores them as time-series data.
- **Grafana** — queries Prometheus and renders the dashboards you viewed. Dashboards were pre-provisioned by the chart, not built from scratch.
- **Alertmanager** — receives firing alerts from Prometheus (based on `PrometheusRule` objects like the one in `monitoring/alert-rules.yaml`) and handles routing/deduplication/notification (in this local setup, alerts just show up in the Alertmanager UI — a real setup would route them to Slack, PagerDuty, email, etc.).
- **Prometheus Operator** — a Kubernetes controller that watches for `PrometheusRule`, `ServiceMonitor`, and similar custom resources and automatically reconfigures Prometheus to match, without needing to manually edit Prometheus's config file and restart it.

### Why metrics-server is separate from Prometheus

They serve different purposes. `metrics-server` provides a lightweight, short-lived (not historical) metrics API that the Kubernetes control plane itself uses for `kubectl top` and HPA decisions. Prometheus is a full time-series database for historical monitoring, alerting, and dashboards. HPA specifically depends on metrics-server (via the `metrics.k8s.io` API), not on Prometheus directly, unless you set up a custom metrics adapter.

---

## 7. Failure Injection and Rollback Demo

What actually happened when you deployed the "broken" image:

1. The new pod started (`Running` at the container level — the process didn't crash).
2. Its `/health` endpoint returned `500` instead of `200`.
3. The **readiness probe** failed → pod never added to the Service's endpoint list → it received zero real traffic.
4. The **liveness probe** also failed (same endpoint) → after `failureThreshold` consecutive failures, Kubernetes killed and restarted the container → it came back, failed again → restart loop (`RESTARTS` counter climbing).
5. Because the Deployment's default rolling-update strategy only removes an old pod once a new one is *ready*, and the new pod never became ready, your old pods were never terminated. Zero real downtime.
6. `helm rollback` reverted the Helm release to its previous revision's values (in this case, back to the working image), which triggered a new rollout back to the known-good state, and the broken pod was cleaned up.

This is precisely the failure mode real rolling-update strategies are designed to prevent, and precisely why teams configure health checks carefully — a health check that always returns 200 regardless of real app state would have let the broken version through.

---

## 8. Local Networking Recap

```
Your browser/curl
      |
localhost:30080  (your Mac)
      |
Kind's Docker container acting as a Kubernetes node
      |
NodePort 30080 --> Service devops-demo-service (ClusterIP, port 80)
      |
Service load-balances across matching pod IPs
      |
Pod's container, listening on port 8080
```

The `extraPortMappings` in `kind-config.yaml` is what actually makes `localhost:30080` on your Mac reach into the Kind cluster's Docker container in the first place — without it, the NodePort would only be reachable from inside the Kind Docker network.

---

## 9. Command Reference (Cheat Sheet)

```bash
# Cluster
kind create cluster --config kubernetes/kind-config.yaml
kind delete cluster --name devops-demo

# Deploy / update
helm install devops-demo ./helm/devops-app
helm upgrade devops-demo ./helm/devops-app
helm rollback devops-demo
helm uninstall devops-demo

# Inspect
kubectl get pods
kubectl get deployment
kubectl get svc
kubectl get hpa
kubectl describe pod <pod-name>
kubectl logs <pod-name>
kubectl top pods

# Debug a failing rollout
kubectl rollout status deployment devops-demo-devops-demo-app
kubectl rollout history deployment devops-demo-devops-demo-app

# Monitoring
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
kubectl get secret -n monitoring monitoring-grafana -o jsonpath="{.data.admin-password}" | base64 --decode
```
