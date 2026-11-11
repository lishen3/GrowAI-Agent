from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class ToolDefinition:
    # Execution lives in the local TypeScript registry, never in this backend.
    name: str
    description: str
    input_model: type[BaseModel]

    def validate(self, arguments: dict) -> dict:
        return self.input_model.model_validate(arguments).model_dump(exclude_none=True, exclude_unset=True)

    def llm_schema(self) -> dict:
        return {'type': 'function', 'function': {
            'name': self.name, 'description': self.description,
            'parameters': self.input_model.model_json_schema(),
        }}
