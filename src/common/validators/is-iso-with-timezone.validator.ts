import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { TimeHelper } from 'src/utils/helpers/time.helper';

export function IsIsoWithTimezone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIsoWithTimezone',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') {
            return false;
          }

          return TimeHelper.isIsoWithTimezone(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be ISO 8601 with timezone (Z or +/-HH:mm)`;
        },
      },
    });
  };
}
