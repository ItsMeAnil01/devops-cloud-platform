FROM node:20-alpine

WORKDIR /usr/src/app

# Install deps first so this layer is cached unless package.json changes
COPY app/package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY app/server.js ./

# Run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
