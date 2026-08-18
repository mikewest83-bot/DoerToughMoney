dev:
	@bash dev.sh

stop:
	@docker compose down

test:
	@cd server && npm test

test-int:
	@cd server && npm run test:integration

.PHONY: dev stop test test-int
