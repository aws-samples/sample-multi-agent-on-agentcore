FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY finance/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY finance/src/ .

EXPOSE 8000

CMD ["opentelemetry-instrument", "python", "mcp_server.py"]
