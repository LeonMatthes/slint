# Contributing

We warmly welcome contributions to the project. Let's discuss ideas or questions
in [Github discussions](https://github.com/slint-ui/slint/discussions) or on our [public chat](https://chat.slint.dev).
Please feel welcome to open GitHub issues or pull requests.
Use 👍 reaction on issues that you consider important.

Issues which we think are suitable for new contributors are tagged with
https://github.com/slint-ui/slint/labels/good%20first%20issue.

If you use an AI coding assistant, set it up to read [AGENTS.md](AGENTS.md) for build commands and
architecture notes specific to this repository.

## Internal documentation

 - [Development guide](docs/development.md)
 - [Building Slint from sources in this repository](docs/building.md)
 - [Testing](docs/testing.md)
 - [GitHub issues triage and labels](docs/internal/triage.md)
 - [Writing style guide](docs/internal/writing-style-guide.md) for commit messages, code comments, and documentation

## License

By contributing to this project, you agree to license your contributions under
the [MIT No Attribution License (MIT-0)](https://opensource.org/license/mit-0).

To confirm this, you'll be asked to sign a simple [Contributor License Agreement (CLA)](https://cla-assistant.io/slint-ui/slint)
when you open a pull request.
The CLA does not assign copyright or transfer ownership, it simply confirms that
you wrote the code yourself and are licensing it under MIT-0.

## Coding Style

For the Rust portion of the code base, the CI enforces the coding style via rustfmt.
For the C++ portion of the code base, the CI enforces the coding style via `clang-format`.

## Adding New Features

If you intend to contribute a new feature to Slint, please discuss it first with the Slint team in its issue before contributing code.
If there is no issue yet, please open one.

Slint is 1.0 and has a stable API, so **discuss the public API first** with the Slint team.
Even if an issue exists, please let us know that you plan to work on it and ping @slint-ui/slint .
That way, your contribution is much more likely to be accepted.

To keep this predictable, a bot checks pull requests from outside the Slint team and closes any
that either leave the "Type of change" section of the pull request template unfilled, or declare
a new feature without referencing an issue. Bug fixes never need an issue.
Nothing is lost when that happens: edit the pull request description to fix it and the bot
reopens the pull request automatically.
Team members can set the `policy override` label to exempt a pull request from these checks.
