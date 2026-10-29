# `jerome version`

Prints the installed version, as `jerome 0.12.2`. `jerome --version` and `jerome -v` do the same.

```sh
npm install -g github:meltinbitfarm/jerome && jerome version
```

Installing or updating ends with it because npm does not show what a package prints while it installs: npm 11 hides the output of install scripts and warns about each one, so a script of Jérôme's own could not tell you the version.
