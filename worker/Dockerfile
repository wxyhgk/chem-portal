FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
# xtb 二进制需宿主机挂载或在此镜像内安装；此处保留占位，实际可通过 COPY 或下载
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker/ ./worker/
COPY shared/ ./shared/
COPY backend/ ./backend/
COPY database/ ./database/
CMD ["python", "-m", "worker.worker"]
