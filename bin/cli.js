#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli-main.js');

runCli(process.argv.slice(2));
