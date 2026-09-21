## Images

`client.Admin.Organization.Usage.Images(ctx, query) (*AdminOrganizationUsageImagesResponse, error)`

**get** `/organization/usage/images`

Get images usage details for the organization.

### Parameters

- `query AdminOrganizationUsageImagesParams`

  - `StartTime param.Field[int64]`

    Start time (Unix seconds) of the query time range, inclusive.

  - `APIKeyIDs param.Field[[]string]`

    Return only usage for these API keys.

  - `BucketWidth param.Field[AdminOrganizationUsageImagesParamsBucketWidth]`

    Width of each time bucket in response. Currently `1m`, `1h` and `1d` are supported, default to `1d`.

    - `const AdminOrganizationUsageImagesParamsBucketWidth1m AdminOrganizationUsageImagesParamsBucketWidth = "1m"`

    - `const AdminOrganizationUsageImagesParamsBucketWidth1h AdminOrganizationUsageImagesParamsBucketWidth = "1h"`

    - `const AdminOrganizationUsageImagesParamsBucketWidth1d AdminOrganizationUsageImagesParamsBucketWidth = "1d"`

  - `EndTime param.Field[int64]`

    End time (Unix seconds) of the query time range, exclusive.

  - `GroupBy param.Field[[]string]`

    Group the usage data by the specified fields. Support fields include `project_id`, `user_id`, `api_key_id`, `model`, `size`, `source` or any combination of them.

    - `const AdminOrganizationUsageImagesParamsGroupByProjectID AdminOrganizationUsageImagesParamsGroupBy = "project_id"`

    - `const AdminOrganizationUsageImagesParamsGroupByUserID AdminOrganizationUsageImagesParamsGroupBy = "user_id"`

    - `const AdminOrganizationUsageImagesParamsGroupByAPIKeyID AdminOrganizationUsageImagesParamsGroupBy = "api_key_id"`

    - `const AdminOrganizationUsageImagesParamsGroupByModel AdminOrganizationUsageImagesParamsGroupBy = "model"`

    - `const AdminOrganizationUsageImagesParamsGroupBySize AdminOrganizationUsageImagesParamsGroupBy = "size"`

    - `const AdminOrganizationUsageImagesParamsGroupBySource AdminOrganizationUsageImagesParamsGroupBy = "source"`

  - `Limit param.Field[int64]`

    Specifies the number of buckets to return.

    - `bucket_width=1d`: default: 7, max: 31
    - `bucket_width=1h`: default: 24, max: 168
    - `bucket_width=1m`: default: 60, max: 1440

  - `Models param.Field[[]string]`

    Return only usage for these models.

  - `Page param.Field[string]`

    A cursor for use in pagination. Corresponding to the `next_page` field from the previous response.

  - `ProjectIDs param.Field[[]string]`

    Return only usage for these projects.

  - `Sizes param.Field[[]string]`

    Return only usages for these image sizes. Possible values are `256x256`, `512x512`, `1024x1024`, `1792x1792`, `1024x1792` or any combination of them.

    - `const AdminOrganizationUsageImagesParamsSize256x256 AdminOrganizationUsageImagesParamsSize = "256x256"`

    - `const AdminOrganizationUsageImagesParamsSize512x512 AdminOrganizationUsageImagesParamsSize = "512x512"`

    - `const AdminOrganizationUsageImagesParamsSize1024x1024 AdminOrganizationUsageImagesParamsSize = "1024x1024"`

    - `const AdminOrganizationUsageImagesParamsSize1792x1792 AdminOrganizationUsageImagesParamsSize = "1792x1792"`

    - `const AdminOrganizationUsageImagesParamsSize1024x1792 AdminOrganizationUsageImagesParamsSize = "1024x1792"`

  - `Sources param.Field[[]string]`

    Return only usages for these sources. Possible values are `image.generation`, `image.edit`, `image.variation` or any combination of them.

    - `const AdminOrganizationUsageImagesParamsSourceImageGeneration AdminOrganizationUsageImagesParamsSource = "image.generation"`

    - `const AdminOrganizationUsageImagesParamsSourceImageEdit AdminOrganizationUsageImagesParamsSource = "image.edit"`

    - `const AdminOrganizationUsageImagesParamsSourceImageVariation AdminOrganizationUsageImagesParamsSource = "image.variation"`

  - `UserIDs param.Field[[]string]`

    Return only usage for these users.

### Returns

- `type AdminOrganizationUsageImagesResponse struct{…}`

  - `Data []AdminOrganizationUsageImagesResponseData`

    - `EndTime int64`

    - `Object Bucket`

      - `const BucketBucket Bucket = "bucket"`

    - `Results []AdminOrganizationUsageImagesResponseDataResultUnion`

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageCompletionsResult struct{…}`

        The aggregated completions usage details of the specific time bucket.

        - `InputTokens int64`

          The aggregated number of input tokens used, including cached and cache-write tokens. This includes text, audio, and image tokens. For customers subscribed to Scale Tier, this includes Scale Tier tokens.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageCompletionsResult`

          - `const OrganizationUsageCompletionsResultOrganizationUsageCompletionsResult OrganizationUsageCompletionsResult = "organization.usage.completions.result"`

        - `OutputTokens int64`

          The aggregated number of output tokens used across text, audio, and image outputs. For customers subscribed to Scale Tier, this includes Scale Tier tokens.

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Batch bool`

          When `group_by=batch`, this field tells whether the grouped usage result is batch or not.

        - `InputAudioTokens int64`

          The aggregated number of uncached audio input tokens used.

        - `InputCacheWriteTokens int64`

          The aggregated number of input tokens written to the cache.

        - `InputCachedAudioTokens int64`

          The aggregated number of cached audio input tokens used.

        - `InputCachedImageTokens int64`

          The aggregated number of cached image input tokens used.

        - `InputCachedTextTokens int64`

          The aggregated number of cached text input tokens used.

        - `InputCachedTokens int64`

          The aggregated number of cached input tokens used across text, audio, and image inputs. For customers subscribed to Scale Tier, this includes Scale Tier tokens.

        - `InputImageTokens int64`

          The aggregated number of uncached image input tokens used.

        - `InputTextTokens int64`

          The aggregated number of uncached text input tokens used, excluding cache-write tokens.

        - `InputUncachedTokens int64`

          The aggregated number of uncached input tokens used across text, audio, and image inputs, excluding cache-write tokens.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `OutputAudioTokens int64`

          The aggregated number of audio output tokens used.

        - `OutputImageTokens int64`

          The aggregated number of image output tokens used.

        - `OutputTextTokens int64`

          The aggregated number of text output tokens used.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `ServiceTier string`

          When `group_by=service_tier`, this field provides the service tier of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageEmbeddingsResult struct{…}`

        The aggregated embeddings usage details of the specific time bucket.

        - `InputTokens int64`

          The aggregated number of input tokens used.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageEmbeddingsResult`

          - `const OrganizationUsageEmbeddingsResultOrganizationUsageEmbeddingsResult OrganizationUsageEmbeddingsResult = "organization.usage.embeddings.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageModerationsResult struct{…}`

        The aggregated moderations usage details of the specific time bucket.

        - `InputTokens int64`

          The aggregated number of input tokens used.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageModerationsResult`

          - `const OrganizationUsageModerationsResultOrganizationUsageModerationsResult OrganizationUsageModerationsResult = "organization.usage.moderations.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageImagesResult struct{…}`

        The aggregated images usage details of the specific time bucket.

        - `Images int64`

          The number of images processed.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageImagesResult`

          - `const OrganizationUsageImagesResultOrganizationUsageImagesResult OrganizationUsageImagesResult = "organization.usage.images.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `Size string`

          When `group_by=size`, this field provides the image size of the grouped usage result.

        - `Source string`

          When `group_by=source`, this field provides the source of the grouped usage result, possible values are `image.generation`, `image.edit`, `image.variation`.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageAudioSpeechesResult struct{…}`

        The aggregated audio speeches usage details of the specific time bucket.

        - `Characters int64`

          The number of characters processed.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageAudioSpeechesResult`

          - `const OrganizationUsageAudioSpeechesResultOrganizationUsageAudioSpeechesResult OrganizationUsageAudioSpeechesResult = "organization.usage.audio_speeches.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageAudioTranscriptionsResult struct{…}`

        The aggregated audio transcriptions usage details of the specific time bucket.

        - `NumModelRequests int64`

          The count of requests made to the model.

        - `Object OrganizationUsageAudioTranscriptionsResult`

          - `const OrganizationUsageAudioTranscriptionsResultOrganizationUsageAudioTranscriptionsResult OrganizationUsageAudioTranscriptionsResult = "organization.usage.audio_transcriptions.result"`

        - `Seconds int64`

          The number of seconds processed.

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageVectorStoresResult struct{…}`

        The aggregated vector stores usage details of the specific time bucket.

        - `Object OrganizationUsageVectorStoresResult`

          - `const OrganizationUsageVectorStoresResultOrganizationUsageVectorStoresResult OrganizationUsageVectorStoresResult = "organization.usage.vector_stores.result"`

        - `UsageBytes int64`

          The vector stores usage in bytes.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageCodeInterpreterSessionsResult struct{…}`

        The aggregated code interpreter sessions usage details of the specific time bucket.

        - `NumSessions int64`

          The number of code interpreter sessions.

        - `Object OrganizationUsageCodeInterpreterSessionsResult`

          - `const OrganizationUsageCodeInterpreterSessionsResultOrganizationUsageCodeInterpreterSessionsResult OrganizationUsageCodeInterpreterSessionsResult = "organization.usage.code_interpreter_sessions.result"`

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageFileSearchesResult struct{…}`

        The aggregated file search calls usage details of the specific time bucket.

        - `NumRequests int64`

          The count of file search calls.

        - `Object OrganizationUsageFileSearchesResult`

          - `const OrganizationUsageFileSearchesResultOrganizationUsageFileSearchesResult OrganizationUsageFileSearchesResult = "organization.usage.file_searches.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

        - `VectorStoreID string`

          When `group_by=vector_store_id`, this field provides the vector store ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationUsageWebSearchesResult struct{…}`

        The aggregated web search calls usage details of the specific time bucket.

        - `NumModelRequests int64`

          The count of model requests.

        - `NumRequests int64`

          The count of web search calls.

        - `Object OrganizationUsageWebSearchesResult`

          - `const OrganizationUsageWebSearchesResultOrganizationUsageWebSearchesResult OrganizationUsageWebSearchesResult = "organization.usage.web_searches.result"`

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API key ID of the grouped usage result.

        - `ContextLevel string`

          When `group_by=context_level`, this field provides the search context size of the grouped usage result.

        - `Model string`

          When `group_by=model`, this field provides the model name of the grouped usage result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped usage result.

        - `UserID string`

          When `group_by=user_id`, this field provides the user ID of the grouped usage result.

      - `type AdminOrganizationUsageImagesResponseDataResultOrganizationCostsResult struct{…}`

        The aggregated costs details of the specific time bucket.

        - `Object OrganizationCostsResult`

          - `const OrganizationCostsResultOrganizationCostsResult OrganizationCostsResult = "organization.costs.result"`

        - `Amount AdminOrganizationUsageImagesResponseDataResultOrganizationCostsResultAmount`

          The monetary value in its associated currency.

          - `Currency string`

            Lowercase ISO-4217 currency e.g. "usd"

          - `Value float64`

            The numeric value of the cost.

        - `APIKeyID string`

          When `group_by=api_key_id`, this field provides the API Key ID of the grouped costs result.

        - `LineItem string`

          When `group_by=line_item`, this field provides the line item of the grouped costs result.

        - `ProjectID string`

          When `group_by=project_id`, this field provides the project ID of the grouped costs result.

        - `Quantity float64`

          When `group_by=line_item`, this field provides the quantity of the grouped costs result.

        - `QuantityUnit CostQuantityUnit`

          The unit of the `quantity` value. If no single supported unit applies to the result, this field is `null`.

          - `string`

          - `type CostQuantityUnit string`

            The unit of the `quantity` value. If no single supported unit applies to the result, this field is `null`.

            - `const CostQuantityUnitTokens CostQuantityUnit = "tokens"`

            - `const CostQuantityUnit1000Tokens CostQuantityUnit = "1000_tokens"`

            - `const CostQuantityUnitDurationSeconds CostQuantityUnit = "duration_seconds"`

            - `const CostQuantityUnitDurationMinutes CostQuantityUnit = "duration_minutes"`

            - `const CostQuantityUnitDurationHours CostQuantityUnit = "duration_hours"`

            - `const CostQuantityUnitGibibyteHours CostQuantityUnit = "gibibyte_hours"`

            - `const CostQuantityUnitImages CostQuantityUnit = "images"`

            - `const CostQuantityUnitCharacters CostQuantityUnit = "characters"`

    - `StartTime int64`

  - `HasMore bool`

  - `NextPage string`

  - `Object Page`

    - `const PagePage Page = "page"`

### Example

```go
package main

import (
  "context"
  "fmt"

  "github.com/openai/openai-go"
  "github.com/openai/openai-go/option"
)

func main() {
  client := openai.NewClient(
    option.WithAdminAPIKey("My Admin API Key"),
  )
  response, err := client.Admin.Organization.Usage.Images(context.TODO(), openai.AdminOrganizationUsageImagesParams{
    StartTime: 0,
  })
  if err != nil {
    panic(err.Error())
  }
  fmt.Printf("%+v\n", response.Data)
}
```

#### Response

```json
{
  "data": [
    {
      "end_time": 0,
      "object": "bucket",
      "results": [
        {
          "input_tokens": 0,
          "num_model_requests": 0,
          "object": "organization.usage.completions.result",
          "output_tokens": 0,
          "api_key_id": "api_key_id",
          "batch": true,
          "input_audio_tokens": 0,
          "input_cache_write_tokens": 0,
          "input_cached_audio_tokens": 0,
          "input_cached_image_tokens": 0,
          "input_cached_text_tokens": 0,
          "input_cached_tokens": 0,
          "input_image_tokens": 0,
          "input_text_tokens": 0,
          "input_uncached_tokens": 0,
          "model": "model",
          "output_audio_tokens": 0,
          "output_image_tokens": 0,
          "output_text_tokens": 0,
          "project_id": "project_id",
          "service_tier": "service_tier",
          "user_id": "user_id"
        }
      ],
      "start_time": 0
    }
  ],
  "has_more": true,
  "next_page": "next_page",
  "object": "page"
}
```
