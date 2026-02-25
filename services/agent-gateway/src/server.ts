import {buildApp} from "./app.js";

const run = async () => {
  const {app, config} = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({signal}, "shutting down");

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({error}, "failed to close cleanly");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({host: config.host, port: config.port});

    app.log.info({host: config.host, port: config.port}, "agent gateway listening");
  } catch (error) {
    app.log.error({error}, "failed to start agent gateway");
    process.exit(1);
  }
};

void run();
