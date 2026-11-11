import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateBy } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { GlobalVersionsDto } from '@/global-packages/dto/global-activity.dto';
import { GLOBAL_ACTIONS } from '@/global-packages/interfaces/global-packages.types';
import type {
  GlobalAction,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import {
  assertGlobalRepairAction,
  isGlobalTargetVersion,
} from '@/global-packages/policy/global-policy';

export class GlobalPreviewDto
  extends GlobalVersionsDto
  implements IGlobalPreviewRequest
{
  @ApiProperty({ enum: [...GLOBAL_ACTIONS] })
  @IsIn([...GLOBAL_ACTIONS])
  @ValidateBy({
    name: 'globalRepairAction',
    validator: {
      validate(value: unknown, args?: ValidationArguments): boolean {
        if (!args) return false;
        const body = args.object as GlobalPreviewDto;
        try {
          assertGlobalRepairAction(
            body.manager,
            value as GlobalAction,
            body.package,
          );
          return true;
        } catch {
          return false;
        }
      },
    },
  })
  action!: GlobalAction;

  @ApiPropertyOptional({
    maxLength: 128,
    description: 'Exact version or tag; required only for change',
  })
  @ValidateBy({
    name: 'globalTargetVersion',
    validator: {
      validate(value: unknown, args?: ValidationArguments): boolean {
        if (!args) return false;
        const body = args.object as { action?: unknown };
        if (body.action === 'change') return isGlobalTargetVersion(value);
        return (
          (body.action === 'remove' || body.action === 'repair') &&
          !Object.hasOwn(body, 'targetVersion')
        );
      },
    },
  })
  declare targetVersion?: string;
}
