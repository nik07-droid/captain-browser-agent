/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IAgent } from './agent';
import { AgentOptions } from './agent-options';

/**
 * Agent constructor type for dependency injection
 */
export type AgentConstructor<
  T extends IAgent = IAgent,
  U extends AgentOptions = AgentOptions,
> = (new (options: U) => T) & {
  label?: string;
  // FIXME: find a better solution for webuiConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webuiConfig?: Record<string, any>;
};
