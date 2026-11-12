# Contributing

Thanks for your interest in hdd-sim.

## Reports and suggestions: open an issue

Bugs, ideas and questions are welcome as [issues](../../issues). For a bug, please include:

- what you did and what you expected,
- your browser and operating system, and the Node version if the server or the export command is
  involved,
- the parameter file ("Save parameters (JSON)" in the page) if the problem depends on the settings.

Please leave personal data and secrets out of issues and attached files.

## Pull requests

Pull requests from outside are not open. Changes to this project follow its specification,
[docs/SPEC.md](docs/SPEC.md): a behaviour change is written into the spec first, then built and
reviewed against it. An issue is the way to start that.

## Your own version

The project is MIT licensed ([LICENSE](LICENSE)), so you are free to fork it and change it. It has
no dependencies: `npm test` runs the tests and `npm start` starts the server.
