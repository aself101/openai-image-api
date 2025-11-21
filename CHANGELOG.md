## [1.1.3](https://github.com/aself101/openai-image-api/compare/v1.1.2...v1.1.3) (2025-11-21)


### Bug Fixes

* **cli:** read version dynamically from package.json ([5474bc7](https://github.com/aself101/openai-image-api/commit/5474bc7ee5fe24027368f41b49fed963942cc9ff))

## [1.1.2](https://github.com/aself101/openai-image-api/compare/v1.1.1...v1.1.2) (2025-11-20)


### Bug Fixes

* **security:** update documentation for DNS rebinding prevention ([baa61ae](https://github.com/aself101/openai-image-api/commit/baa61aec7e8b228170ea241094666adcf9545423))

## [1.1.1](https://github.com/aself101/openai-image-api/compare/v1.1.0...v1.1.1) (2025-11-20)


### Bug Fixes

* version update ([230009e](https://github.com/aself101/openai-image-api/commit/230009e4eae7423468ce0909a154ff35a5a1180d))
* version update ([d1ed904](https://github.com/aself101/openai-image-api/commit/d1ed90416d66411431cac8eea7150de9d5db8092))

# [1.1.0](https://github.com/aself101/openai-image-api/compare/v1.0.1...v1.1.0) (2025-11-20)


### Features

* add comprehensive video API documentation and validate with live testing ([ffe0b11](https://github.com/aself101/openai-image-api/commit/ffe0b111ae7ca74c1af9b903aff07233f602790f))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-11-15

### Added
- Initial release of OpenAI Image Generation API wrapper
- Support for DALL-E 2, DALL-E 3, and GPT Image 1 models
- Three operation modes: generate, edit, variation
- Command-line interface with `openai-img` binary
- Comprehensive parameter validation for all models
- Batch processing support for multiple prompts
- Organized data storage with timestamped filenames and metadata
- Winston logging with configurable levels
- 128 comprehensive tests with Vitest
- Security features:
  - SSRF protection (blocks localhost, private IPs, cloud metadata endpoints)
  - File input validation with magic byte checking
  - Enhanced API key format validation (supports both sk-* and sk-proj-* formats)
  - HTTPS enforcement for API base URL
  - Rate limiting to prevent quota exhaustion
  - API key redaction in logs
  - Error message sanitization for production environments
- Detailed README with examples, troubleshooting, and model comparison
- API key configuration via multiple methods (CLI flag, env var, .env files)
- Support for all model-specific features:
  - DALL-E 2: Multiple images, variations, edits
  - DALL-E 3: HD quality, vivid/natural styles
  - GPT Image 1: Transparent backgrounds, multi-image editing, compression control

### Security
- Implemented SSRF protection to prevent access to internal resources
- Added file validation to ensure only valid image files are processed
- Enhanced API key format validation with regex patterns
- Enforced HTTPS-only connections to API endpoints
- Added rate limiting to prevent API abuse
- Implemented log sanitization to prevent API key exposure
- Added production-safe error messages to prevent information disclosure

### Documentation
- Comprehensive README with installation, usage, and examples
- API documentation for all public methods
- Troubleshooting guide with common errors and solutions
- Model comparison table
- Organization verification requirements for GPT Image 1

[1.0.0]: https://github.com/aself101/opernai-image-api/releases/tag/v1.0.0
