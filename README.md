# DevOps Cloud-Native CI/CD & Monitoring Platform

A mini production deployment platform demonstrating the full DevOps lifecycle:

**Code → Test → Containerize → Deploy → Scale → Monitor → Detect Failure → Recover**

A Node.js API is automatically tested and containerized on every push, deployed to a local Kubernetes cluster via Helm, scaled automatically under load, and monitored with Prometheus + Grafana.

---

## Architecture

```
Developer
   |
   | git push
   v
GitHub  --------->  GitHub Actions (CI/CD)
                         |
                    Run Tests
                         |
                    Build Docker Image (multi-arch: amd64 + arm64)
                         |
                    Push to Docker Hub
                         |
                         v
              Kubernetes Cluster (Kind, local)
                         |
        -----------------------------------
        |            |            |
      Pod 1        Pod 2        Pod 3   <-- managed by Helm chart
        |            |            |
        -----------------------------------
                         |
                 Kubernetes Service (NodePort)
                         |
                    Application traffic
                         |
        -----------------------------------
        |                                |
  Liveness/Readiness              Prometheus (metrics)
  Probes (/health)                       |
        |                          Grafana (dashboards)
   Auto-restart on                       |
   failure                        Alertmanager (alerts)
                         |
            Horizontal Pod Autoscaler (HPA)
            scales 2 -> 5 pods under CPU load
```

---

## Tech Stack

| Layer | Tools |
|---|---|
| Application | Node.js, Express |
| Testing | Jest, Supertest |
| Source control | Git, GitHub |
| CI/CD | GitHub Actions |
| Containerization | Docker (multi-platform builds via Buildx) |
| Registry | Docker Hub |
| Orchestration | Kubernetes (Kind) |
| Package management | Helm |
| Monitoring | Prometheus, Grafana, Alertmanager (via kube-prometheus-stack) |
| Config management | ConfigMaps, Secrets |
| Autoscaling | Horizontal Pod Autoscaler (HPA) + metrics-server |

---

## Repository Structure

```
devops-cloud-platform/
├── app/
│   ├── server.js              # Express API: /health, /api/status, /api/users
│   ├── package.json
│   └── tests/
│       └── server.test.js     # Jest test suite, gates the CI pipeline
│
├── Dockerfile                  # Multi-stage-friendly, non-root user, healthcheck
├── .dockerignore
├── .gitignore
│
├── .github/
│   └── workflows/
│       └── ci-cd.yml           # Test -> build multi-arch image -> push to Docker Hub
│
├── kubernetes/                 # Raw manifests (superseded by Helm chart, kept for reference)
│   ├── kind-config.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── secret.yaml
│
├── helm/
│   └── devops-app/
│       ├── Chart.yaml
│       ├── values.yaml         # Replicas, image tag, resources, probes, autoscaling
│       └── templates/
│           ├── deployment.yaml
│           ├── service.yaml
│           ├── configmap.yaml
│           ├── secret.yaml
│           └── hpa.yaml
│
├── monitoring/
│   └── alert-rules.yaml        # PrometheusRule: high CPU + pod-not-ready alerts
│
├── HOW_IT_WORKS.md             # Deep walkthrough of every component and command
├── INTERVIEW_PREP.md           # DevOps/Cloud interview Q&A related to this project
└── README.md                   # This file
```

---

## Prerequisites

- Docker Desktop
- kubectl
- Kind
- Helm
- Node.js (v18+)
- Git
- A Docker Hub account (free tier is fine)
- A GitHub account

---

## Setup: Step by Step

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/devops-cloud-platform.git
cd devops-cloud-platform
cd app && npm install && cd ..
```

### 2. Run tests locally

```bash
cd app
npm test
cd ..
```

### 3. Build and run the Docker image locally (sanity check)

```bash
docker build -t devops-demo-app:local .
docker run -p 8080:8080 devops-demo-app:local
```

Verify:
```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/status
curl http://localhost:8080/api/users
```

Stop the container with `Ctrl+C` once confirmed.

### 4. Set up CI/CD (GitHub Actions + Docker Hub)

1. Push this repo to your own GitHub repository.
2. Create a Docker Hub access token: Docker Hub → Account Settings → Security → New Access Token.
3. In your GitHub repo: Settings → Secrets and variables → Actions → add:
   - `DOCKERHUB_USERNAME` — your Docker Hub username
   - `DOCKERHUB_TOKEN` — the access token
4. Push a commit. Check the **Actions** tab — the pipeline runs tests, then builds and pushes a multi-arch image (`linux/amd64,linux/arm64`) to Docker Hub.

### 5. Create a local Kubernetes cluster

```bash
kind create cluster --config kubernetes/kind-config.yaml
```

### 6. Install metrics-server (required for autoscaling)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'
```

Wait ~30 seconds, then confirm:
```bash
kubectl top nodes
```

### 7. Deploy the application via Helm

Update `helm/devops-app/values.yaml` so `image.repository` points to **your** Docker Hub image (`your-dockerhub-username/devops-demo-app`), then:

```bash
helm install devops-demo ./helm/devops-app
```

Check status:
```bash
kubectl get pods
kubectl get svc
```

Test:
```bash
curl http://localhost:30080/health
curl http://localhost:30080/api/users
```

### 8. Install the monitoring stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl create namespace monitoring
helm install monitoring prometheus-community/kube-prometheus-stack --namespace monitoring
```

Apply the custom alert rules:
```bash
kubectl apply -f monitoring/alert-rules.yaml
```

Access Grafana:
```bash
kubectl get secret -n monitoring monitoring-grafana -o jsonpath="{.data.admin-password}" | base64 --decode; echo
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Open http://localhost:3000, log in with `admin` and the password above. Go to **Dashboards → Kubernetes / Compute Resources / Namespace (Pods)**, set namespace to `default`.

### 9. Demonstrate autoscaling

```bash
kubectl run load-generator --image=busybox --restart=Never -- /bin/sh -c \
  "while true; do wget -q -O- http://devops-demo-service.default.svc.cluster.local/api/status; done"
kubectl get hpa -w
```

Once you've seen it scale up:
```bash
kubectl delete pod load-generator
```

### 10. Demonstrate failure recovery and rollback

See `HOW_IT_WORKS.md` for the full walkthrough of:
- Killing a pod and watching Kubernetes self-heal
- Deploying a deliberately broken image and watching the rolling update protect production traffic
- Rolling back with `helm rollback devops-demo`

---

## Tearing Down

```bash
helm uninstall devops-demo
helm uninstall monitoring -n monitoring
kubectl delete namespace monitoring
kind delete cluster --name devops-demo
```

---

## What This Project Demonstrates

Git · GitHub · Docker · multi-arch builds · CI/CD (GitHub Actions) · Kubernetes · Helm · ConfigMaps/Secrets · liveness/readiness probes · Horizontal Pod Autoscaling · Prometheus · Grafana · Alertmanager · rolling updates and rollback · basic SRE/observability practices.

See `INTERVIEW_PREP.md` for how to talk about this in an interview, and `HOW_IT_WORKS.md` for a component-by-component explanation of what's actually happening under the hood.
