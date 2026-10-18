#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { defineConnectPlatform } from '../lib/stages';

defineConnectPlatform(new cdk.App());
