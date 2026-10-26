FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY relay.cjs ./
COPY lib/room.cjs lib/room.cjs
USER node
ENV HOST=0.0.0.0 PORT=8765
EXPOSE 8765
CMD ["node", "relay.cjs"]
